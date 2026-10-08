import { NextResponse } from "next/server";
import { requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { patientDuplicateEvidence, sortDuplicateCandidates } from "@/lib/patient-duplicate-review";
import { normalizePatientName, normalizePatientPhone } from "@/lib/patient-normalization";

function text(value: unknown, max = 220) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function dateValue(value: unknown) {
  const raw = text(value, 20);
  if (!raw) return null;
  const parsed = new Date(raw + "T00:00:00.000Z");
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function isoDate(value: Date | null) {
  return value ? value.toISOString().slice(0, 10) : null;
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("patients.manage");
  const ctx = await requestContext();
  const { id } = await params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const expectedUpdatedAtRaw = text(body.expectedUpdatedAt, 40);
  const expectedUpdatedAt = expectedUpdatedAtRaw ? new Date(expectedUpdatedAtRaw) : null;
  const changeReason = text(body.changeReason, 1000);
  if (!expectedUpdatedAt || Number.isNaN(expectedUpdatedAt.getTime())) {
    return NextResponse.json({ error: "expected_updated_at_required" }, { status: 400 });
  }
  if (!changeReason) {
    return NextResponse.json({ error: "change_reason_required" }, { status: 400 });
  }

  const fullNameEn = text(body.fullNameEn);
  const fullNameAr = text(body.fullNameAr);
  const dob = dateValue(body.dateOfBirth);
  const sexAtBirth = ["MALE", "FEMALE"].includes(String(body.sexAtBirth))
    ? String(body.sexAtBirth) as "MALE" | "FEMALE" | "UNKNOWN"
    : undefined;
  const phone = text(body.phone, 50);
  const whatsapp = text(body.whatsapp, 50);
  const email = text(body.email, 191).toLowerCase();
  const nationalityCode = text(body.nationalityCode, 2).toUpperCase();
  const address = text(body.address, 4000);
  const ageText = text(body.recordedAgeValue, 5);
  const ageUnit = text(body.recordedAgeUnit, 8);
  const recordedAgeValue = /^(0|[1-9][0-9]{0,4})$/.test(ageText) ? Number(ageText) : null;
  const notes = text(body.notes, 4000);
  const clinicalInformation = text(body.clinicalInformation, 4000);
  const duplicateReviewOverride = body.duplicateReviewOverride === true;
  const duplicateReviewReason = text(body.duplicateReviewReason, 1000);

  if (!fullNameEn) return NextResponse.json({ error: "name_required" }, { status: 400 });
  if (dob === undefined) return NextResponse.json({ error: "invalid_date_of_birth" }, { status: 400 });
  if (dob && dob.getTime() > Date.now()) return NextResponse.json({ error: "future_date_of_birth" }, { status: 400 });
  if (!sexAtBirth) return NextResponse.json({ error: "invalid_sex" }, { status: 400 });
  if (recordedAgeValue === null || !["DAY","MONTH","YEAR"].includes(ageUnit) ||
      (ageUnit === "YEAR" && recordedAgeValue > 150) ||
      (ageUnit === "MONTH" && recordedAgeValue > 1800) ||
      (ageUnit === "DAY" && recordedAgeValue > 54787)) {
    return NextResponse.json({ error: "invalid_recorded_age" }, { status: 400 });
  }
  if (nationalityCode && !/^[A-Z]{2}$/.test(nationalityCode)) {
    return NextResponse.json({ error: "invalid_nationality_code" }, { status: 400 });
  }

  const patient = await prisma.patient.findFirst({
    where: { id, organizationId: session.user.organizationId },
  });
  if (!patient) return NextResponse.json({ error: "patient_not_found" }, { status: 404 });
  if (patient.status !== "ACTIVE" || patient.mergedIntoPatientId) {
    return NextResponse.json({ error: "patient_not_editable" }, { status: 409 });
  }
  if (patient.updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
    return NextResponse.json({ error: "patient_state_changed", updatedAt: patient.updatedAt.toISOString() }, { status: 409 });
  }

  const normalizedName = normalizePatientName(fullNameEn);
  const normalizedPhone = phone ? normalizePatientPhone(phone) : null;
  const duplicateOr = [
    ...(dob ? [{ normalizedName, dateOfBirth: dob }] : []),
    ...(normalizedPhone ? [{ normalizedPhone }] : []),
  ];
  const duplicateRows = duplicateOr.length > 0
    ? await prisma.patient.findMany({
        where: {
          organizationId: session.user.organizationId,
          id: { not: patient.id },
          status: "ACTIVE",
          mergedIntoPatientId: null,
          OR: duplicateOr,
        },
        select: {
          id: true,
          patientNumber: true,
          fullNameEn: true,
          fullNameAr: true,
          normalizedName: true,
          dateOfBirth: true,
          phone: true,
          normalizedPhone: true,
        },
        take: 10,
      })
    : [];

  const duplicateCandidates = sortDuplicateCandidates(
    duplicateRows
      .map(candidate => ({
        id: candidate.id,
        patientNumber: candidate.patientNumber,
        fullNameEn: candidate.fullNameEn,
        fullNameAr: candidate.fullNameAr,
        dateOfBirth: candidate.dateOfBirth,
        phone: candidate.phone,
        evidence: patientDuplicateEvidence(
          { normalizedName, dateOfBirth: dob, normalizedPhone },
          candidate,
        ),
      }))
      .filter(candidate => candidate.evidence.length > 0),
  );

  if (duplicateCandidates.length > 0 && !duplicateReviewOverride) {
    return NextResponse.json({ error: "possible_duplicates", candidates: duplicateCandidates }, { status: 409 });
  }
  if (duplicateCandidates.length > 0 && duplicateReviewOverride && !duplicateReviewReason) {
    return NextResponse.json({ error: "duplicate_review_reason_required" }, { status: 400 });
  }

  const oldValues = {
    fullNameEn: patient.fullNameEn,
    fullNameAr: patient.fullNameAr,
    dateOfBirth: isoDate(patient.dateOfBirth),
    sexAtBirth: patient.sexAtBirth,
    phone: patient.phone,
    whatsapp: patient.whatsapp,
    email: patient.email,
    nationalityCode: patient.nationalityCode,
    address: patient.address,
    recordedAgeValue: patient.recordedAgeValue,
    recordedAgeUnit: patient.recordedAgeUnit,
    notes: patient.notes,
    clinicalInformation: patient.clinicalInformation,
  };
  const newValues = {
    fullNameEn,
    fullNameAr: fullNameAr || null,
    dateOfBirth: isoDate(dob),
    sexAtBirth,
    phone: phone || null,
    whatsapp: whatsapp || null,
    email: email || null,
    nationalityCode: nationalityCode || null,
    address: address || null,
    recordedAgeValue,
    recordedAgeUnit: ageUnit,
    notes: notes || null,
    clinicalInformation: clinicalInformation || null,
  };
  const changedFields = Object.keys(newValues).filter(key =>
    oldValues[key as keyof typeof oldValues] !== newValues[key as keyof typeof newValues]
  );
  if (changedFields.length === 0) {
    return NextResponse.json({ error: "no_changes" }, { status: 400 });
  }

  const updated = await prisma.$transaction(async tx => {
    const changed = await tx.patient.updateMany({
      where: {
        id: patient.id,
        organizationId: session.user.organizationId,
        status: "ACTIVE",
        mergedIntoPatientId: null,
        updatedAt: expectedUpdatedAt,
      },
      data: {
        fullNameEn,
        fullNameAr: fullNameAr || null,
        normalizedName,
        dateOfBirth: dob,
        recordedAgeValue,
        recordedAgeUnit: ageUnit,
        recordedAgeAt: (patient.recordedAgeValue !== recordedAgeValue || patient.recordedAgeUnit !== ageUnit)
          ? new Date() : patient.recordedAgeAt,
        address: address || null,
        sexAtBirth,
        phone: phone || null,
        normalizedPhone,
        whatsapp: whatsapp || null,
        email: email || null,
        nationalityCode: nationalityCode || null,
        notes: notes || null,
        clinicalInformation: clinicalInformation || null,
      },
    });
    if (changed.count !== 1) return null;

    const current = await tx.patient.findUniqueOrThrow({ where: { id: patient.id } });
    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: session.activeBranchId,
        actorUserId: session.user.id,
        action: "PATIENT_UPDATED",
        entityType: "Patient",
        entityId: patient.id,
        oldValues,
        newValues: { ...newValues, changedFields },
        reason: changeReason,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });

    if (duplicateCandidates.length > 0 && duplicateReviewOverride) {
      await tx.auditEvent.create({
        data: {
          organizationId: session.user.organizationId,
          branchId: session.activeBranchId,
          actorUserId: session.user.id,
          action: "PATIENT_DUPLICATE_REVIEW_OVERRIDE",
          entityType: "Patient",
          entityId: patient.id,
          newValues: {
            context: "PATIENT_UPDATE",
            reviewedCandidateIds: duplicateCandidates.map(candidate => candidate.id),
            evidence: duplicateCandidates.map(candidate => ({
              patientId: candidate.id,
              patientNumber: candidate.patientNumber,
              evidence: candidate.evidence,
            })),
          },
          reason: duplicateReviewReason,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
      });
    }

    return current;
  });

  if (!updated) {
    return NextResponse.json({ error: "patient_state_changed" }, { status: 409 });
  }

  return NextResponse.json({
    status: "ok",
    patient: {
      id: updated.id,
      patientNumber: updated.patientNumber,
      updatedAt: updated.updatedAt,
    },
  });
}
