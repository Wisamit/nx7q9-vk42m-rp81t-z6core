import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { patientDuplicateEvidence, sortDuplicateCandidates } from "@/lib/patient-duplicate-review";
import { normalizePatientIdentifier, normalizePatientName, normalizePatientPhone } from "@/lib/patient-normalization";

function text(value: unknown, max = 220) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
function newPatientNumber() {
  const now = new Date();
  const date = now.toISOString().slice(0,10).replace(/-/g,"");
  return `P-${date}-${randomBytes(3).toString("hex").toUpperCase()}`;
}

export async function POST(request: Request) {
  const session = await requirePermission("patients.manage");
  const ctx = await requestContext();
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const fullNameEn = text(body.fullNameEn);
  const fullNameAr = text(body.fullNameAr);
  const dateOfBirth = text(body.dateOfBirth, 20);
  const sexAtBirth = ["MALE","FEMALE","UNKNOWN"].includes(body.sexAtBirth) ? body.sexAtBirth : "UNKNOWN";
  const phone = text(body.phone, 50);
  const whatsapp = text(body.whatsapp, 50);
  const email = text(body.email, 191).toLowerCase();
  const nationalId = text(body.nationalId, 120);
  const passportNumber = text(body.passportNumber, 120);
  const passportIssuingCountry = text(body.passportIssuingCountry, 2).toUpperCase();
  const nationalityCode = text(body.nationalityCode, 2).toUpperCase();
  const addressEn = text(body.addressEn, 4000);
  const addressAr = text(body.addressAr, 4000);
  const notes = text(body.notes, 4000);
  const clinicalInformation = text(body.clinicalInformation, 4000);
  const duplicateReviewOverride = body.duplicateReviewOverride === true;
  const duplicateReviewReason = text(body.duplicateReviewReason, 1000);

  if (!fullNameEn) return NextResponse.json({ error: "name_required" }, { status: 400 });
  if (nationalityCode && !/^[A-Z]{2}$/.test(nationalityCode)) {
    return NextResponse.json({ error: "invalid_nationality_code" }, { status: 400 });
  }
  if (passportIssuingCountry && !/^[A-Z]{2}$/.test(passportIssuingCountry)) {
    return NextResponse.json({ error: "invalid_passport_issuing_country" }, { status: 400 });
  }

  const nameKey = normalizePatientName(fullNameEn);
  const phoneKey = phone ? normalizePatientPhone(phone) : null;
  const dob = dateOfBirth ? new Date(`${dateOfBirth}T00:00:00.000Z`) : null;
  if (dateOfBirth && Number.isNaN(dob?.getTime())) return NextResponse.json({ error: "invalid_date_of_birth" }, { status: 400 });

  const duplicateOr = [
    ...(dob ? [{ normalizedName: nameKey, dateOfBirth: dob }] : []),
    ...(phoneKey ? [{ normalizedPhone: phoneKey }] : []),
  ];
  const duplicateRows = duplicateOr.length > 0
    ? await prisma.patient.findMany({
        where: {
          organizationId: session.user.organizationId,
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
          { normalizedName: nameKey, dateOfBirth: dob, normalizedPhone: phoneKey },
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

  const idKey = nationalId ? normalizePatientIdentifier(nationalId) : null;
  const passportKey = passportNumber ? normalizePatientIdentifier(passportNumber) : null;
  const identifierChecks = [
    ...(idKey ? [{ identifierType: "NATIONAL_ID" as const, normalizedValue: idKey }] : []),
    ...(passportKey ? [{ identifierType: "PASSPORT" as const, normalizedValue: passportKey }] : []),
  ];
  for (const identifier of identifierChecks) {
    const existingId = await prisma.patientIdentifier.findUnique({
      where: {
        organizationId_identifierType_normalizedValue: {
          organizationId: session.user.organizationId,
          identifierType: identifier.identifierType,
          normalizedValue: identifier.normalizedValue,
        },
      },
      include: { patient: { select: { id: true, patientNumber: true, fullNameEn: true } } },
    });
    if (existingId) {
      return NextResponse.json({
        error: "identifier_already_used",
        identifierType: identifier.identifierType,
        patient: existingId.patient,
      }, { status: 409 });
    }
  }

  const created = await prisma.$transaction(async (tx) => {
    let patientNumber = newPatientNumber();
    while (await tx.patient.findUnique({ where: { organizationId_patientNumber: { organizationId: session.user.organizationId, patientNumber } } })) {
      patientNumber = newPatientNumber();
    }

    const patient = await tx.patient.create({
      data: {
        organizationId: session.user.organizationId,
        patientNumber,
        fullNameEn,
        fullNameAr: fullNameAr || null,
        normalizedName: nameKey,
        dateOfBirth: dob,
        sexAtBirth,
        phone: phone || null,
        normalizedPhone: phoneKey,
        whatsapp: whatsapp || null,
        email: email || null,
        nationalityCode: nationalityCode || null,
        addressEn: addressEn || null,
        addressAr: addressAr || null,
        notes: notes || null,
        clinicalInformation: clinicalInformation || null,
        creationBranchId: session.activeBranchId || null,
      },
    });

    if (idKey) {
      await tx.patientIdentifier.create({
        data: {
          organizationId: session.user.organizationId,
          patientId: patient.id,
          identifierType: "NATIONAL_ID",
          value: nationalId,
          normalizedValue: idKey,
          isPrimary: true,
        },
      });
    }

    if (passportKey) {
      await tx.patientIdentifier.create({
        data: {
          organizationId: session.user.organizationId,
          patientId: patient.id,
          identifierType: "PASSPORT",
          value: passportNumber,
          normalizedValue: passportKey,
          issuingCountry: passportIssuingCountry || null,
          isPrimary: !idKey,
        },
      });
    }

    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: session.activeBranchId,
        actorUserId: session.user.id,
        action: "PATIENT_CREATED",
        entityType: "Patient",
        entityId: patient.id,
        newValues: {
          patientNumber,
          fullNameEn,
          fullNameAr: fullNameAr || null,
          dateOfBirth: dateOfBirth || null,
          sexAtBirth,
          phone: phone || null,
          whatsapp: whatsapp || null,
          email: email || null,
          nationalityCode: nationalityCode || null,
          addressEn: addressEn || null,
          addressAr: addressAr || null,
          notes: notes || null,
          clinicalInformation: clinicalInformation || null,
          creationBranchId: session.activeBranchId || null,
          identifierTypes: identifierChecks.map(item => item.identifierType),
        },
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
            patientNumber: patient.patientNumber,
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

    return patient;
  });

  return NextResponse.json({ status: "ok", patient: created }, { status: 201 });
}
