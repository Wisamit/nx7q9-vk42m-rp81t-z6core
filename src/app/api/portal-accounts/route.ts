import { NextResponse } from "next/server";
import { requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";

function text(value: unknown, max = 255) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
function normalizedPhone(value: string) {
  return value.replace(/[^0-9+]/g, "").slice(0, 50);
}

export async function POST(request: Request) {
  const session = await requirePermission("portal_accounts.manage");
  const ctx = await requestContext();
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const type = ["PATIENT","DOCTOR","CORPORATE"].includes(body.type) ? body.type : null;
  const patientId = text(body.patientId, 36) || null;
  const referrerId = text(body.referrerId, 36) || null;
  const clientId = text(body.clientId, 36) || null;
  const email = text(body.email, 191).toLowerCase() || null;
  const phone = normalizedPhone(text(body.phone, 50)) || null;
  const preferredLocale = body.preferredLocale === "ar" ? "ar" : "en";

  if (!type || (!email && !phone)) {
    return NextResponse.json({ error: "type_and_contact_required" }, { status: 400 });
  }
  const subjectIds = [patientId, referrerId, clientId].filter(Boolean);
  if (subjectIds.length !== 1 ||
      (type === "PATIENT" && !patientId) ||
      (type === "DOCTOR" && !referrerId) ||
      (type === "CORPORATE" && !clientId)) {
    return NextResponse.json({ error: "portal_subject_mismatch" }, { status: 400 });
  }

  const orgId = session.user.organizationId;
  const [patient, referrer, client] = await Promise.all([
    patientId ? prisma.patient.findFirst({ where: { id: patientId, organizationId: orgId, status: "ACTIVE" } }) : null,
    referrerId ? prisma.referrer.findFirst({ where: { id: referrerId, organizationId: orgId, status: "ACTIVE" } }) : null,
    clientId ? prisma.client.findFirst({ where: { id: clientId, organizationId: orgId, status: "ACTIVE" } }) : null,
  ]);
  if ((patientId && !patient) || (referrerId && !referrer) || (clientId && !client)) {
    return NextResponse.json({ error: "portal_subject_not_found" }, { status: 404 });
  }

  const duplicate = await prisma.portalAccount.findFirst({
    where: {
      organizationId: orgId,
      OR: [
        ...(email ? [{ normalizedEmail: email }] : []),
        ...(phone ? [{ normalizedPhone: phone }] : []),
      ],
    },
    select: { id: true, type: true },
  });
  if (duplicate) return NextResponse.json({ error: "portal_contact_already_in_use" }, { status: 409 });

  const account = await prisma.$transaction(async tx => {
    const created = await tx.portalAccount.create({
      data: {
        organizationId: orgId,
        type,
        patientId,
        referrerId,
        clientId,
        email,
        normalizedEmail: email,
        phone,
        normalizedPhone: phone,
        preferredLocale,
        status: "INVITED",
      },
    });
    await tx.auditEvent.create({
      data: {
        organizationId: orgId,
        branchId: session.activeBranchId,
        actorUserId: session.user.id,
        action: "PORTAL_ACCOUNT_PROVISIONED",
        entityType: "PortalAccount",
        entityId: created.id,
        newValues: { type, patientId, referrerId, clientId, email, phone, preferredLocale, status: "INVITED" },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
    return created;
  });

  return NextResponse.json({ status: "ok", account }, { status: 201 });
}
