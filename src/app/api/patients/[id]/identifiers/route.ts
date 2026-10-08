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
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const schemeId = text(body.schemeId, 36);
  const value = text(body.value, 120);
  const issuingCountry = text(body.issuingCountry, 2).toUpperCase();
  if (!schemeId || !value) return NextResponse.json({ error: "scheme_and_value_required" }, { status: 400 });
  if (issuingCountry && !/^[A-Z]{2}$/.test(issuingCountry)) {
    return NextResponse.json({ error: "invalid_identifier_issuing_country" }, { status: 400 });
  }

  const [patient, scheme] = await Promise.all([
    prisma.patient.findFirst({
      where: {
        id: patientId,
        organizationId: session.user.organizationId,
        status: "ACTIVE",
        mergedIntoPatientId: null,
      },
      select: { id: true, patientNumber: true },
    }),
    prisma.patientIdentifierScheme.findFirst({
      where: { id: schemeId, organizationId: session.user.organizationId, status: "ACTIVE" },
    }),
  ]);
  if (!patient) return NextResponse.json({ error: "patient_not_editable" }, { status: 409 });
  if (!scheme) return NextResponse.json({ error: "identifier_scheme_not_available" }, { status: 404 });
  if (scheme.requiresIssuingCountry && !issuingCountry) {
    return NextResponse.json({ error: "identifier_issuing_country_required" }, { status: 400 });
  }

  const normalizedValue = normalizePatientIdentifier(value);
  if (!normalizedValue) return NextResponse.json({ error: "invalid_identifier_value" }, { status: 400 });

  const existing = await prisma.patientIdentifier.findUnique({
    where: {
      organizationId_schemeId_normalizedValue: {
        organizationId: session.user.organizationId,
        schemeId: scheme.id,
        normalizedValue,
      },
    },
    include: { patient: { select: { id: true, patientNumber: true, fullNameEn: true } } },
  });
  if (existing) {
    return NextResponse.json({
      error: "identifier_already_used",
      patient: existing.patient,
      schemeCode: scheme.code,
    }, { status: 409 });
  }

  const created = await prisma.$transaction(async tx => {
    const activeCount = await tx.patientIdentifier.count({
      where: { patientId: patient.id, status: "ACTIVE" },
    });
    const identifier = await tx.patientIdentifier.create({
      data: {
        organizationId: session.user.organizationId,
        patientId: patient.id,
        schemeId: scheme.id,
        identifierType: scheme.identifierType,
        value,
        normalizedValue,
        issuingCountry: issuingCountry || null,
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
    return identifier;
  });

  return NextResponse.json({ status: "ok", identifier: created }, { status: 201 });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requirePermission("patients.manage");
  const ctx = await requestContext();
  const { id: patientId } = await params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const identifierId = text(body.identifierId, 36);
  const reason = text(body.reason, 1000);
  if (!identifierId || !reason) {
    return NextResponse.json({ error: "identifier_and_reason_required" }, { status: 400 });
  }

  const identifier = await prisma.patientIdentifier.findFirst({
    where: {
      id: identifierId,
      patientId,
      organizationId: session.user.organizationId,
      status: "ACTIVE",
      patient: { status: "ACTIVE", mergedIntoPatientId: null },
    },
    include: {
      patient: { select: { patientNumber: true } },
      scheme: { select: { code: true } },
    },
  });
  if (!identifier) return NextResponse.json({ error: "identifier_not_found_or_inactive" }, { status: 404 });

  const deactivatedAt = new Date();
  const updated = await prisma.$transaction(async tx => {
    const changed = await tx.patientIdentifier.updateMany({
      where: { id: identifier.id, status: "ACTIVE" },
      data: { status: "INACTIVE" },
    });
    if (changed.count !== 1) return null;

    if (identifier.isPrimary) {
      const replacement = await tx.patientIdentifier.findFirst({
        where: {
          patientId,
          status: "ACTIVE",
          id: { not: identifier.id },
        },
        orderBy: { createdAt: "asc" },
      });
      if (replacement) {
        await tx.patientIdentifier.update({
          where: { id: replacement.id },
          data: { isPrimary: true },
        });
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
        newValues: { status: "INACTIVE", deactivatedAt },
        reason,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
    return true;
  });

  if (!updated) return NextResponse.json({ error: "identifier_state_changed" }, { status: 409 });
  return NextResponse.json({ status: "ok" });
}
