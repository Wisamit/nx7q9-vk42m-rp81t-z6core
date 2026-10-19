import type { Prisma, PrismaClient } from "../../generated/prisma/client";
import {
  normalizePortalContactDestination,
  resolveVerifiedPortalDestination,
  type ReportOutboundChannel,
  type ReportOutboundRecipientType,
} from "./report-outbound.ts";

type DbClient = PrismaClient | Prisma.TransactionClient;

export type ReportRecipientAuthorizationInput = {
  organizationId: string;
  recipientType: ReportOutboundRecipientType;
  recipientId: string;
  patientId: string;
  channel: ReportOutboundChannel;
  destination: string;
  expectedPortalAccountId?: string;
};

/**
 * Recheck consent-bound report delivery targets at queue time (row locks)
 * and immediately before provider dispatch (fresh DB reads). Never infer
 * delivery permission from an old notification destination.
 */
export async function currentReportRecipientAuthorized(
  db: DbClient,
  input: ReportRecipientAuthorizationInput,
  lockRows = false,
): Promise<boolean> {
  if (!input.recipientId || !input.patientId || !input.destination) return false;

  const expectedType = input.recipientType === "PATIENT"
    ? "PATIENT" : input.recipientType === "REFERRER" ? "DOCTOR" : "CORPORATE";
  const ownerScope = input.recipientType === "PATIENT"
    ? { patientId: input.recipientId }
    : input.recipientType === "REFERRER"
      ? { referrerId: input.recipientId }
      : { clientId: input.recipientId };

  const account = await db.portalAccount.findFirst({
    where: {
      organizationId: input.organizationId,
      type: expectedType,
      ...(input.expectedPortalAccountId ? { id: input.expectedPortalAccountId } : {}),
      ...ownerScope,
    },
    select: { id: true, status: true, email: true, phone: true, preferredLocale: true },
  });
  if (!account) return false;

  let status = account.status;
  let email = account.email;
  let phone = account.phone;
  let locale = account.preferredLocale;
  const contactChannel = input.channel === "EMAIL" ? "EMAIL" : "PHONE";
  let contacts: Array<{ channel: "EMAIL" | "PHONE"; destinationSnapshot: string; revokedAt: Date | null }>;

  if (lockRows) {
    // This is a current (locking) InnoDB read, not a stale transaction
    // snapshot. Revocation/status edits on these rows must serialize with
    // notification creation and its audit record.
    const accounts = await db.$queryRaw<Array<{
      status: string; email: string | null; phone: string | null;
      preferredLocale: string; type: string;
      patientId: string | null; referrerId: string | null; clientId: string | null;
    }>>`
      SELECT status, email, phone, preferred_locale AS preferredLocale,
             type, patient_id AS patientId, referrer_id AS referrerId, client_id AS clientId
      FROM portal_accounts
      WHERE id = ${account.id} AND organization_id = ${input.organizationId}
      FOR UPDATE
    `;
    const latest = accounts[0];
    if (!latest || latest.type !== expectedType) return false;
    const currentRecipientId = input.recipientType === "PATIENT"
      ? latest.patientId : input.recipientType === "REFERRER"
        ? latest.referrerId : latest.clientId;
    if (currentRecipientId !== input.recipientId) return false;
    status = latest.status as typeof status;
    email = latest.email;
    phone = latest.phone;
    locale = latest.preferredLocale;

    const lockedContacts = await db.$queryRaw<Array<{
      channel: "EMAIL" | "PHONE"; destinationSnapshot: string; revokedAt: Date | null;
    }>>`
      SELECT channel, destination_snapshot AS destinationSnapshot, revoked_at AS revokedAt
      FROM portal_contact_verifications
      WHERE portal_account_id = ${account.id} AND channel = ${contactChannel}
      FOR UPDATE
    `;
    contacts = lockedContacts;
  } else {
    contacts = await db.portalContactVerification.findMany({
      where: { portalAccountId: account.id, channel: contactChannel, revokedAt: null },
      select: { channel: true, destinationSnapshot: true, revokedAt: true },
    });
  }

  const verified = resolveVerifiedPortalDestination({
    status, email, phone, preferredLocale: locale,
    contactVerifiedAt: null, emailVerifiedAt: null, phoneVerifiedAt: null,
    contactVerifications: contacts,
  }, input.channel);
  if (!verified.ok ||
      normalizePortalContactDestination(contactChannel, verified.destination) !==
        normalizePortalContactDestination(contactChannel, input.destination)) return false;

  if (input.recipientType === "CLIENT") {
    if (lockRows) {
      const grants = await db.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM corporate_portal_patient_access
        WHERE client_id = ${input.recipientId}
          AND patient_id = ${input.patientId}
          AND status = 'ACTIVE' AND can_view_reports = 1
          AND effective_from <= NOW(3)
          AND (effective_to IS NULL OR effective_to >= NOW(3))
        FOR UPDATE
      `;
      return grants.length > 0;
    }
    const grant = await db.corporatePortalPatientAccess.findFirst({
      where: {
        clientId: input.recipientId, patientId: input.patientId,
        status: "ACTIVE", canViewReports: true,
        effectiveFrom: { lte: new Date() },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: new Date() } }],
      },
      select: { id: true },
    });
    return Boolean(grant);
  }
  return true;
}
