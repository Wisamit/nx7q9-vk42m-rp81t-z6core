import { hash } from "bcryptjs";
import { randomInt } from "node:crypto";
import { NextResponse } from "next/server";
import {
  NotificationChannel,
  NotificationRecipientType,
} from "../../../../../../../generated/prisma/client";
import { getCurrentPortalSession } from "@/lib/portal-auth";
import { prisma } from "@/lib/db";
import { enqueueNotification } from "@/lib/notifications";
import { requestContext } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { maskedDestination } from "@/lib/report-outbound";

function recipientType(accountType: "PATIENT" | "DOCTOR" | "CORPORATE") {
  if (accountType === "PATIENT") return NotificationRecipientType.PATIENT;
  if (accountType === "DOCTOR") return NotificationRecipientType.REFERRER;
  return NotificationRecipientType.CLIENT;
}

function recipientReferenceId(account: {
  type: "PATIENT" | "DOCTOR" | "CORPORATE";
  patientId: string | null;
  referrerId: string | null;
  clientId: string | null;
}) {
  return account.type === "PATIENT" ? account.patientId
    : account.type === "DOCTOR" ? account.referrerId
      : account.clientId;
}

export async function POST(request: Request) {
  const session = await getCurrentPortalSession();
  if (!session) return NextResponse.json({ error: "portal_unauthorized" }, { status: 401 });
  const account = session.portalAccount;
  if (account.mustChangePassword) {
    return NextResponse.json({ error: "password_change_required" }, { status: 409 });
  }

  const ctx = await requestContext();
  const body = await request.json().catch(() => null) as { channel?: string } | null;
  const channel = body?.channel === "EMAIL" ? "EMAIL" : body?.channel === "SMS" ? "SMS" : null;
  if (!channel) return NextResponse.json({ error: "invalid_verification_channel" }, { status: 400 });

  const destination = channel === "EMAIL" ? account.email?.trim() : account.phone?.trim();
  if (!destination) {
    return NextResponse.json({
      error: channel === "EMAIL" ? "portal_email_missing" : "portal_phone_missing",
    }, { status: 409 });
  }

  const rate = await checkRateLimit({
    scope: "portal_contact_verification",
    key: account.id + ":" + channel,
    limit: 5,
    windowMs: 15 * 60_000,
  });
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }

  const code = String(randomInt(100000, 1000000));
  const codeHash = await hash(code, 10);
  const expiresAt = new Date(Date.now() + 10 * 60_000);
  const refId = recipientReferenceId(account);
  if (!refId) return NextResponse.json({ error: "portal_subject_missing" }, { status: 409 });

  let challenge;
  try {
    challenge = await prisma.$transaction(async tx => {
    // Serialize all issuance and replacement for this same portal account.
    // Without locking its parent row, two parallel POSTs could both observe
    // zero active challenges and leave two usable OTPs.
    const live = await tx.$queryRaw<Array<{
      id:string;email:string|null;phone:string|null;must_change_password:number|boolean;
    }>>`
      SELECT id,email,phone,must_change_password
      FROM portal_accounts
      WHERE id=${account.id} AND organization_id=${account.organizationId}
        AND status='ACTIVE'
      FOR UPDATE
    `;
    const current = live[0];
    const currentDestination = channel === "EMAIL" ? current?.email?.trim() : current?.phone?.trim();
    if (live.length !== 1 || current?.must_change_password || currentDestination !== destination) {
      throw new Error("PORTAL_CONTACT_ISSUANCE_CHANGED");
    }

    const replacedChallenges = await tx.portalOtpChallenge.findMany({
      where: {
        portalAccountId: account.id,
        purpose: "VERIFY_CONTACT",
        consumedAt: null,
      },
      select: { id: true },
    });
    const replacedIds = replacedChallenges.map(item => item.id);
    if (replacedIds.length > 0) {
      await tx.portalOtpChallenge.updateMany({
        where: { id: { in: replacedIds } },
        data: { consumedAt: new Date() },
      });
      await tx.notification.updateMany({
        where: {
          eventCode: "PORTAL_VERIFY_CONTACT",
          entityType: "PortalOtpChallenge",
          entityId: { in: replacedIds },
        },
        data: { body: "Verification code replaced." },
      });
    }

    const created = await tx.portalOtpChallenge.create({
      data: {
        portalAccountId: account.id,
        purpose: "VERIFY_CONTACT",
        destination,
        codeHash,
        expiresAt,
        requestIp: ctx.ipAddress,
      },
    });

    await enqueueNotification(tx, {
      organizationId: account.organizationId,
      eventCode: "PORTAL_VERIFY_CONTACT",
      recipientType: recipientType(account.type),
      recipientReferenceId: refId,
      title: account.preferredLocale === "ar" ? "رمز التحقق من جهة الاتصال" : "Contact verification code",
      body: account.preferredLocale === "ar"
        ? `رمز التحقق هو ${code}. تنتهي صلاحيته خلال 10 دقائق.`
        : `Your verification code is ${code}. It expires in 10 minutes.`,
      entityType: "PortalOtpChallenge",
      entityId: created.id,
      metadata: {
        purpose: "VERIFY_CONTACT",
        portalAccountId: account.id,
        channel,
      },
      channels: [NotificationChannel[channel]],
      destinations: { [NotificationChannel[channel]]: destination },
    });

    await tx.auditEvent.create({
      data: {
        organizationId: account.organizationId,
        actorUserId: null,
        action: "PORTAL_CONTACT_VERIFICATION_REQUESTED",
        entityType: "PortalAccount",
        entityId: account.id,
        sessionId: session.id,
        newValues: {
          channel,
          destinationMasked: maskedDestination(channel, destination),
          challengeId: created.id,
          expiresAt: expiresAt.toISOString(),
        },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });

    return created;
    });
  } catch (error) {
    if (error instanceof Error && error.message === "PORTAL_CONTACT_ISSUANCE_CHANGED") {
      return NextResponse.json({ error: "portal_subject_changed" }, { status: 409 });
    }
    throw error;
  }

  return NextResponse.json({
    status: "queued",
    challengeId: challenge.id,
    channel,
    destination: maskedDestination(channel, destination),
    expiresAt: challenge.expiresAt.toISOString(),
  }, { status: 201 });
}
