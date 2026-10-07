import { NextResponse } from "next/server";
import { requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { maskedDestination } from "@/lib/report-outbound";

function text(value: unknown, max = 1000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("portal_accounts.manage");
  const ctx = await requestContext();
  const { id } = await params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const channel = body.channel === "EMAIL" || body.channel === "PHONE" ? body.channel : null;
  const reason = text(body.reason, 1000);
  if (!channel || !reason) {
    return NextResponse.json({ error: "channel_and_reason_required" }, { status: 400 });
  }

  const account = await prisma.portalAccount.findFirst({
    where: { id, organizationId: session.user.organizationId },
    include: {
      contactVerifications: {
        where: { channel, revokedAt: null },
        orderBy: { verifiedAt: "desc" },
      },
    },
  });
  if (!account) return NextResponse.json({ error: "portal_account_not_found" }, { status: 404 });
  if (account.status === "DISABLED") {
    return NextResponse.json({ error: "disabled_portal_account" }, { status: 409 });
  }

  const destination = channel === "EMAIL" ? account.email?.trim() : account.phone?.trim();
  if (!destination) {
    return NextResponse.json({
      error: channel === "EMAIL" ? "portal_email_required" : "portal_phone_required",
    }, { status: 409 });
  }

  const current = account.contactVerifications.find(item => item.destinationSnapshot === destination);
  if (current) {
    return NextResponse.json({
      error: "contact_already_verified",
      verificationId: current.id,
    }, { status: 409 });
  }

  const now = new Date();
  let verification: { id: string };
  try {
    verification = await prisma.$transaction(async tx => {
      const claim = await tx.portalAccount.updateMany({
        where: { id: account.id, updatedAt: account.updatedAt },
        data: { contactVerifiedAt: now },
      });
      if (claim.count !== 1) throw new Error("PORTAL_CONTACT_VERIFICATION_CONFLICT");

      await tx.portalContactVerification.updateMany({
        where: {
          portalAccountId: account.id,
          channel,
          revokedAt: null,
        },
        data: { revokedAt: now },
      });

      const created = await tx.portalContactVerification.create({
        data: {
          portalAccountId: account.id,
          channel,
          destinationSnapshot: destination,
          method: "STAFF_CONFIRMED",
          verificationReason: reason,
          verifiedByUserId: session.user.id,
          verifiedAt: now,
        },
      });

      await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: session.activeBranchId,
        actorUserId: session.user.id,
        action: "PORTAL_CONTACT_VERIFIED",
        entityType: "PortalAccount",
        entityId: account.id,
        oldValues: {
          channel,
          previousActiveVerificationIds: account.contactVerifications.map(item => item.id),
        },
        newValues: {
          verificationId: created.id,
          channel,
          method: "STAFF_CONFIRMED",
          destinationMasked: maskedDestination(channel === "EMAIL" ? "EMAIL" : "SMS", destination),
          reason,
          verifiedAt: now,
        },
        reason,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });

      return created;
    });
  } catch (error) {
    if (error instanceof Error && error.message === "PORTAL_CONTACT_VERIFICATION_CONFLICT") {
      return NextResponse.json({ error: "contact_verification_conflict" }, { status: 409 });
    }
    throw error;
  }

  return NextResponse.json({
    status: "ok",
    verificationId: verification.id,
    channel,
    destination: maskedDestination(channel === "EMAIL" ? "EMAIL" : "SMS", destination),
  }, { status: 201 });
}
