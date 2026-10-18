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
    const outcome = await prisma.$transaction(async tx => {
      // Same active organization lock as patient create/identifier add/merge.
      // Scheme lifecycle transitions and registrations must serialize.
      const tenant = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM organizations
        WHERE id = ${session.user.organizationId} AND status = 'ACTIVE'
        FOR UPDATE
      `;
      if (tenant.length !== 1) return { kind: "organization_unavailable" } as const;
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

      return { kind: "created", scheme: created } as const;
    }, { timeout: 30000 });

    if (outcome.kind === "organization_unavailable")
      return NextResponse.json({ error: "organization_unavailable" }, { status: 403 });
    return NextResponse.json({ status: "ok", scheme: outcome.scheme }, { status: 201 });
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

  const deactivatedAt = new Date();
  const outcome = await prisma.$transaction(async tx => {
    // Lock BEFORE checking lifecycle and type. No last-moment scheme
    // deactivation may race a patient registration using this scheme.
    const tenant = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM organizations
      WHERE id = ${session.user.organizationId} AND status = 'ACTIVE'
      FOR UPDATE
    `;
    if (tenant.length !== 1) return { kind: "organization_unavailable" } as const;
    const scheme = await tx.patientIdentifierScheme.findFirst({
      where: { id, organizationId: session.user.organizationId },
    });
    if (!scheme) return { kind: "identifier_scheme_not_found" } as const;
    if (scheme.identifierType !== "OTHER" || scheme.code === "LEGACY_OTHER")
      return { kind: "standard_identifier_scheme_cannot_be_deactivated" } as const;
    if (scheme.status !== "ACTIVE")
      return { kind: "identifier_scheme_already_inactive" } as const;

    const changed = await tx.patientIdentifierScheme.updateMany({
      where: {
        id: scheme.id, organizationId: session.user.organizationId, status: "ACTIVE",
      },
      data: { status: "INACTIVE", deactivatedAt },
    });
    if (changed.count !== 1) return { kind: "identifier_scheme_state_changed" } as const;
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
    const current = await tx.patientIdentifierScheme.findUniqueOrThrow({
      where: { id: scheme.id },
    });
    return { kind: "deactivated", scheme: current } as const;
  }, { timeout: 30000 });

  if (outcome.kind === "organization_unavailable")
    return NextResponse.json({ error: "organization_unavailable" }, { status: 403 });
  if (outcome.kind !== "deactivated") {
    return NextResponse.json({ error: outcome.kind },
      { status: outcome.kind === "identifier_scheme_not_found" ? 404 : 409 });
  }
  return NextResponse.json({ status: "ok", scheme: outcome.scheme });
}
