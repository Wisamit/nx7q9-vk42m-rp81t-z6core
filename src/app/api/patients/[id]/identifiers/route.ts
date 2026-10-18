import { NextResponse } from "next/server";
import { requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { normalizePatientIdentifier } from "@/lib/patient-normalization";

function text(value: unknown, max = 180) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requirePermission("patients.manage");
  const ctx = await requestContext();
  const { id: patientId } = await params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || Array.isArray(body))
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const schemeId = text(body.schemeId, 36);
  const value = text(body.value, 120);
  const issuingCountry = text(body.issuingCountry, 2).toUpperCase();
  if (!schemeId || !value) return NextResponse.json({ error: "scheme_and_value_required" }, { status: 400 });
  if (issuingCountry && !/^[A-Z]{2}$/.test(issuingCountry)) {
    return NextResponse.json({ error: "invalid_identifier_issuing_country" }, { status: 400 });
  }
  const normalizedValue = normalizePatientIdentifier(value);
  if (!normalizedValue) return NextResponse.json({ error: "invalid_identifier_value" }, { status: 400 });

  // Preflight identity reads are unsafe: a concurrent merge could change the
  // canonical patient after it was checked but before identifier creation.
  let outcome;
  try {
    outcome = await prisma.$transaction(async tx => {
      // Same tenant-wide write lock as patient create/edit/merge, first read
      // in transaction. Serializes first-party mutation across all branches.
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM organizations
        WHERE id = ${session.user.organizationId} AND status = 'ACTIVE'
        FOR UPDATE
      `;
      if (locked.length !== 1) return { kind: "organization_unavailable" } as const;
      const patient = await tx.patient.findFirst({
        where: {
          id: patientId, organizationId: session.user.organizationId,
          status: "ACTIVE", mergedIntoPatientId: null,
        },
        select: { id: true, patientNumber: true },
      });
      if (!patient) return { kind: "patient_not_editable" } as const;
      const scheme = await tx.patientIdentifierScheme.findFirst({
        where: { id: schemeId, organizationId: session.user.organizationId, status: "ACTIVE" },
      });
      if (!scheme) return { kind: "identifier_scheme_not_available" } as const;
      if (scheme.requiresIssuingCountry && !issuingCountry)
        return { kind: "identifier_issuing_country_required" } as const;

      const existing = await tx.patientIdentifier.findUnique({
        where: {
          organizationId_schemeId_normalizedValue: {
            organizationId: session.user.organizationId,
            schemeId: scheme.id, normalizedValue,
          },
        },
        include: { patient: { select: { id: true, patientNumber: true, fullNameEn: true } } },
      });
      // Historical inactive identifiers remain reserved; never recycle keys
      // or silently redirect the identifier to another patient.
      if (existing) return {
        kind: "identifier_already_used", patient: existing.patient, schemeCode: scheme.code,
      } as const;
      const activeCount = await tx.patientIdentifier.count({
        where: { patientId: patient.id, organizationId: session.user.organizationId, status: "ACTIVE" },
      });
      const identifier = await tx.patientIdentifier.create({
        data: {
          organizationId: session.user.organizationId,
          patientId: patient.id,
          schemeId: scheme.id,
          identifierType: scheme.identifierType,
          value, normalizedValue, issuingCountry: issuingCountry || null,
          isPrimary: activeCount === 0,
        },
      });
      await tx.auditEvent.create({
        data: {
          organizationId: session.user.organizationId,
          branchId: session.activeBranchId,
          actorUserId: session.user.id,
          action: "PATIENT_IDENTIFIER_ADDED",
          entityType: "PatientIdentifier",
          entityId: identifier.id,
          newValues: {
            patientId: patient.id,
            patientNumber: patient.patientNumber,
            schemeId: scheme.id,
            schemeCode: scheme.code,
            identifierType: scheme.identifierType,
            issuingCountry: identifier.issuingCountry,
            isPrimary: identifier.isPrimary,
          },
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
      });
      return { kind: "created", identifier } as const;
    }, { timeout: 30000 });
  } catch (error) {
    // A conflicting writer outside our first-party lock can still reach the
    // unique index. Fail closed instead of exposing an uncaught database error.
    if (error && typeof error === "object" && "code" in error && error.code === "P2002")
      return NextResponse.json({ error: "identifier_already_used" }, { status: 409 });
    throw error;
  }

  if (outcome.kind === "organization_unavailable")
    return NextResponse.json({ error: "organization_unavailable" }, { status: 403 });
  if (outcome.kind === "patient_not_editable")
    return NextResponse.json({ error: "patient_not_editable" }, { status: 409 });
  if (outcome.kind === "identifier_scheme_not_available")
    return NextResponse.json({ error: "identifier_scheme_not_available" }, { status: 404 });
  if (outcome.kind === "identifier_issuing_country_required")
    return NextResponse.json({ error: "identifier_issuing_country_required" }, { status: 400 });
  if (outcome.kind === "identifier_already_used")
    return NextResponse.json({
      error: "identifier_already_used", patient: outcome.patient, schemeCode: outcome.schemeCode,
    }, { status: 409, headers: { "Cache-Control": "private, no-store" } });
  return NextResponse.json({ status: "ok", identifier: outcome.identifier },
    { status: 201, headers: { "Cache-Control": "private, no-store" } });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requirePermission("patients.manage");
  const ctx = await requestContext();
  const { id: patientId } = await params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || Array.isArray(body))
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const identifierId = text(body.identifierId, 36);
  const reason = text(body.reason, 1000);
  if (!identifierId || !reason)
    return NextResponse.json({ error: "identifier_and_reason_required" }, { status: 400 });

  const deactivatedAt = new Date();
  const outcome = await prisma.$transaction(async tx => {
    // First read locks this tenant's identity writes. A simultaneous patient
    // merge must not allow deactivation/promotion on an obsolete alias.
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM organizations
      WHERE id = ${session.user.organizationId} AND status = 'ACTIVE'
      FOR UPDATE
    `;
    if (locked.length !== 1) return { kind: "organization_unavailable" } as const;
    const patient = await tx.patient.findFirst({
      where: {
        id: patientId, organizationId: session.user.organizationId,
        status: "ACTIVE", mergedIntoPatientId: null,
      },
      select: { id: true, patientNumber: true },
    });
    if (!patient) return { kind: "patient_not_editable" } as const;
    const identifier = await tx.patientIdentifier.findFirst({
      where: {
        id: identifierId, patientId: patient.id,
        organizationId: session.user.organizationId, status: "ACTIVE",
      },
      include: { scheme: { select: { code: true } } },
    });
    if (!identifier) return { kind: "identifier_not_found_or_inactive" } as const;

    const changed = await tx.patientIdentifier.updateMany({
      where: {
        id: identifier.id, patientId: patient.id,
        organizationId: session.user.organizationId, status: "ACTIVE",
      },
      data: { status: "INACTIVE" },
    });
    if (changed.count !== 1) return { kind: "identifier_state_changed" } as const;
    let replacementPrimaryIdentifierId: string | null = null;
    if (identifier.isPrimary) {
      const remaining = await tx.patientIdentifier.findMany({
        where: {
          patientId: patient.id,
          organizationId: session.user.organizationId, status: "ACTIVE",
          id: { not: identifier.id },
        },
        select: { id: true, isPrimary: true },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });
      // Never introduce a second primary if already present from legacy data.
      if (remaining.length > 0 && !remaining.some(item => item.isPrimary)) {
        const replacement = remaining[0];
        await tx.patientIdentifier.update({
          where: { id: replacement.id },
          data: { isPrimary: true },
        });
        replacementPrimaryIdentifierId = replacement.id;
      }
    }

    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: session.activeBranchId,
        actorUserId: session.user.id,
        action: "PATIENT_IDENTIFIER_DEACTIVATED",
        entityType: "PatientIdentifier",
        entityId: identifier.id,
        oldValues: {
          status: identifier.status,
          isPrimary: identifier.isPrimary,
          schemeCode: identifier.scheme.code,
          value: identifier.value,
        },
        newValues: { status: "INACTIVE", deactivatedAt, replacementPrimaryIdentifierId },
        reason,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
    return { kind: "deactivated" } as const;
  }, { timeout: 30000 });

  if (outcome.kind === "organization_unavailable")
    return NextResponse.json({ error: "organization_unavailable" }, { status: 403 });
  if (outcome.kind === "patient_not_editable")
    return NextResponse.json({ error: "patient_not_editable" }, { status: 409 });
  if (outcome.kind === "identifier_not_found_or_inactive")
    return NextResponse.json({ error: "identifier_not_found_or_inactive" }, { status: 404 });
  if (outcome.kind === "identifier_state_changed")
    return NextResponse.json({ error: "identifier_state_changed" }, { status: 409 });
  return NextResponse.json({ status: "ok" }, { headers: { "Cache-Control": "private, no-store" } });
}
