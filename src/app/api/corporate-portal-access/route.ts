import { NextResponse } from "next/server";
import { requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";

function text(value: unknown, max = 100) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function POST(request: Request) {
  const session = await requirePermission("portal_accounts.manage");
  const ctx = await requestContext();
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const clientId = text(body.clientId, 36);
  const patientId = text(body.patientId, 36);
  const employeeNumber = text(body.employeeNumber, 100) || null;
  const effectiveFrom = body.effectiveFrom ? new Date(String(body.effectiveFrom)) : new Date();
  const effectiveTo = body.effectiveTo ? new Date(String(body.effectiveTo)) : null;
  if (!clientId || !patientId || Number.isNaN(effectiveFrom.getTime())) {
    return NextResponse.json({ error: "missing_required_fields" }, { status: 400 });
  }
  if (effectiveTo && (Number.isNaN(effectiveTo.getTime()) || effectiveTo < effectiveFrom)) {
    return NextResponse.json({ error: "invalid_effective_dates" }, { status: 400 });
  }

  const [client, patient] = await Promise.all([
    prisma.client.findFirst({ where: { id: clientId, organizationId: session.user.organizationId, status: "ACTIVE" } }),
    prisma.patient.findFirst({ where: { id: patientId, organizationId: session.user.organizationId, status: "ACTIVE" } }),
  ]);
  if (!client || !patient) return NextResponse.json({ error: "client_or_patient_not_found" }, { status: 404 });

  const access = await prisma.$transaction(async tx => {
    const created = await tx.corporatePortalPatientAccess.create({
      data: {
        clientId,
        patientId,
        employeeNumber,
        effectiveFrom,
        effectiveTo,
        canViewReports: body.canViewReports === true,
        canBook: body.canBook !== false,
      },
    });
    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: session.activeBranchId,
        actorUserId: session.user.id,
        action: "CORPORATE_PORTAL_PATIENT_ACCESS_CREATED",
        entityType: "CorporatePortalPatientAccess",
        entityId: created.id,
        newValues: {
          clientId, patientId, employeeNumber, effectiveFrom, effectiveTo,
          canViewReports: created.canViewReports, canBook: created.canBook,
        },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
    return created;
  });

  return NextResponse.json({ status: "ok", access }, { status: 201 });
}
