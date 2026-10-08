import { NextResponse } from "next/server";
import { requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";

function text(value: unknown, max = 180) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function code(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80);
}

export async function POST(request: Request) {
  const session = await requirePermission("patients.manage");
  const ctx = await requestContext();
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const nameEn = text(body.nameEn);
  const nameAr = text(body.nameAr);
  const schemeCode = code(text(body.code, 80) || nameEn);
  const requiresIssuingCountry = body.requiresIssuingCountry === true;
  if (!nameEn || !schemeCode) {
    return NextResponse.json({ error: "name_and_code_required" }, { status: 400 });
  }
  if (["NATIONAL_ID", "PASSPORT", "LEGACY_OTHER"].includes(schemeCode)) {
    return NextResponse.json({ error: "reserved_identifier_scheme_code" }, { status: 409 });
  }

  try {
    const scheme = await prisma.$transaction(async tx => {
      const created = await tx.patientIdentifierScheme.create({
        data: {
          organizationId: session.user.organizationId,
          code: schemeCode,
          nameEn,
          nameAr: nameAr || null,
          identifierType: "OTHER",
          requiresIssuingCountry,
        },
      });

      await tx.auditEvent.create({
        data: {
          organizationId: session.user.organizationId,
          branchId: session.activeBranchId,
          actorUserId: session.user.id,
          action: "PATIENT_IDENTIFIER_SCHEME_CREATED",
          entityType: "PatientIdentifierScheme",
          entityId: created.id,
          newValues: {
            code: created.code,
            nameEn: created.nameEn,
            nameAr: created.nameAr,
            identifierType: created.identifierType,
            requiresIssuingCountry: created.requiresIssuingCountry,
          },
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
      });

      return created;
    });

    return NextResponse.json({ status: "ok", scheme }, { status: 201 });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
      return NextResponse.json({ error: "identifier_scheme_code_exists" }, { status: 409 });
    }
    throw error;
  }
}

export async function PATCH(request: Request) {
  const session = await requirePermission("patients.manage");
  const ctx = await requestContext();
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const id = text(body.id, 36);
  const reason = text(body.reason, 1000);
  if (!id || !reason) return NextResponse.json({ error: "id_and_reason_required" }, { status: 400 });

  const scheme = await prisma.patientIdentifierScheme.findFirst({
    where: { id, organizationId: session.user.organizationId },
  });
  if (!scheme) return NextResponse.json({ error: "identifier_scheme_not_found" }, { status: 404 });
  if (scheme.identifierType !== "OTHER" || scheme.code === "LEGACY_OTHER") {
    return NextResponse.json({ error: "standard_identifier_scheme_cannot_be_deactivated" }, { status: 409 });
  }
  if (scheme.status !== "ACTIVE") {
    return NextResponse.json({ error: "identifier_scheme_already_inactive" }, { status: 409 });
  }

  const deactivatedAt = new Date();
  const updated = await prisma.$transaction(async tx => {
    const changed = await tx.patientIdentifierScheme.updateMany({
      where: { id: scheme.id, status: "ACTIVE" },
      data: { status: "INACTIVE", deactivatedAt },
    });
    if (changed.count !== 1) return null;

    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: session.activeBranchId,
        actorUserId: session.user.id,
        action: "PATIENT_IDENTIFIER_SCHEME_DEACTIVATED",
        entityType: "PatientIdentifierScheme",
        entityId: scheme.id,
        oldValues: { status: scheme.status },
        newValues: { status: "INACTIVE", deactivatedAt },
        reason,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });

    return tx.patientIdentifierScheme.findUniqueOrThrow({ where: { id: scheme.id } });
  });

  if (!updated) return NextResponse.json({ error: "identifier_scheme_state_changed" }, { status: 409 });
  return NextResponse.json({ status: "ok", scheme: updated });
}
