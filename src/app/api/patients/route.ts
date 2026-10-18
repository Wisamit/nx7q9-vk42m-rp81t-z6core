import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { patientDuplicateEvidence, sortDuplicateCandidates } from "@/lib/patient-duplicate-review";
import { PATIENT_DUPLICATE_REVIEW_MAX_CANDIDATES, patientCandidateReviewIsCurrent, patientReviewedCandidateIds } from "@/lib/patient-registration-review-guard";
import { normalizePatientIdentifier, normalizePatientName, normalizePatientPhone } from "@/lib/patient-normalization";
import {
  evaluatePatientCreationReplay, patientCreationPayloadHash, patientCreationSubmissionKey,
} from "@/lib/patient-creation-idempotency";

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
  if (!body || typeof body !== "object" || Array.isArray(body))
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  const submission = patientCreationSubmissionKey(request.headers.get("x-family-lab-patient-key"));
  if (!submission.valid)
    return NextResponse.json({ error: "invalid_patient_submission_key" }, { status: 400 });
  // This fingerprint contains no logged PII. Keyed retries must reproduce
  // the *exact* original intent, including duplicate-review authorization.
  const payloadHash = submission.key ? patientCreationPayloadHash(body) : null;
  const replayResponse = async (): Promise<NextResponse | null> => {
    if (!submission.key || !payloadHash) return null;
    const prior = await prisma.patient.findFirst({
      where: {
        organizationId: session.user.organizationId,
        creationRequestUserId: session.user.id,
        creationSubmissionKey: submission.key,
      },
      select: {
        id: true, patientNumber: true, fullNameEn: true,
        status: true, mergedIntoPatientId: true, creationPayloadHash: true,
      },
    });
    const decision = evaluatePatientCreationReplay(prior, payloadHash);
    if (decision.kind === "new") return null;
    if (decision.kind === "conflict") return NextResponse.json({
      error: "patient_creation_submission_conflict",
    }, { status: 409, headers: { "Cache-Control": "private, no-store" } });
    if (decision.kind === "record_changed") return NextResponse.json({
      error: "patient_creation_record_changed",
    }, { status: 409, headers: { "Cache-Control": "private, no-store" } });
    // No second patient/identifier/audit event, even after a lost 201 response.
    return NextResponse.json({
      status: "ok", replayed: true,
      patient: { id: prior!.id, patientNumber: prior!.patientNumber, fullNameEn: prior!.fullNameEn },
    }, { status: 200, headers: { "Cache-Control": "private, no-store" } });
  };
  // Replay MUST precede duplicate detection: the original patient might now
  // be one of the candidates, and must not trigger an override/new identity.
  const replay = await replayResponse();
  if (replay) return replay;

  const fullNameEn = text(body.fullNameEn);
  const fullNameAr = text(body.fullNameAr);
  const dateOfBirth = text(body.dateOfBirth, 20);
  const sexAtBirth = ["MALE","FEMALE"].includes(body.sexAtBirth) ? body.sexAtBirth as "MALE" | "FEMALE" : null;
  if (!sexAtBirth) return NextResponse.json({ error: "sex_required" }, { status: 400 });
  const ageText = text(body.recordedAgeValue, 5);
  const ageUnit = text(body.recordedAgeUnit, 8);
  const recordedAgeValue = /^(0|[1-9][0-9]{0,4})$/.test(ageText) ? Number(ageText) : null;
  if (recordedAgeValue === null || !["DAY","MONTH","YEAR"].includes(ageUnit) ||
      (ageUnit === "YEAR" && recordedAgeValue > 150) ||
      (ageUnit === "MONTH" && recordedAgeValue > 1800) ||
      (ageUnit === "DAY" && recordedAgeValue > 54787)) {
    return NextResponse.json({ error: "invalid_recorded_age" }, { status: 400 });
  }
  const address = text(body.address, 4000);
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
  const reviewedCandidateIds = duplicateReviewOverride ? patientReviewedCandidateIds(body.reviewedCandidateIds) : [];
  const customIdentifierInput = Array.isArray(body.customIdentifiers) ? body.customIdentifiers.slice(0, 10) : [];

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
  if (dob && dob.getTime() > Date.now()) return NextResponse.json({ error: "future_date_of_birth" }, { status: 400 });

  const duplicateOr = [
    ...(dob ? [{ normalizedName: nameKey, dateOfBirth: dob }] : []),
    ...(phoneKey ? [{ normalizedPhone: phoneKey }] : []),
  ];
  // The authoritative duplicate search happens after the organization write lock.
  // An unlocked preflight can race a second registration with a different key.

  const schemes = await prisma.patientIdentifierScheme.findMany({
    where: { organizationId: session.user.organizationId, status: "ACTIVE" },
    select: {
      id: true,
      code: true,
      nameEn: true,
      nameAr: true,
      identifierType: true,
      requiresIssuingCountry: true,
    },
  });
  const schemeById = new Map(schemes.map(scheme => [scheme.id, scheme]));
  const schemeByCode = new Map(schemes.map(scheme => [scheme.code, scheme]));
  const nationalIdScheme = schemeByCode.get("NATIONAL_ID");
  const passportScheme = schemeByCode.get("PASSPORT");
  if ((nationalId && !nationalIdScheme) || (passportNumber && !passportScheme)) {
    return NextResponse.json({ error: "standard_identifier_scheme_missing" }, { status: 409 });
  }

  const identifierChecks: Array<{
    schemeId: string;
    schemeCode: string;
    identifierType: "NATIONAL_ID" | "PASSPORT" | "OTHER";
    value: string;
    normalizedValue: string;
    issuingCountry: string | null;
    isPrimary: boolean;
  }> = [];
  const idKey = nationalId ? normalizePatientIdentifier(nationalId) : null;
  const passportKey = passportNumber ? normalizePatientIdentifier(passportNumber) : null;

  if (idKey && nationalIdScheme) {
    identifierChecks.push({
      schemeId: nationalIdScheme.id,
      schemeCode: nationalIdScheme.code,
      identifierType: nationalIdScheme.identifierType,
      value: nationalId,
      normalizedValue: idKey,
      issuingCountry: null,
      isPrimary: true,
    });
  }
  if (passportKey && passportScheme) {
    identifierChecks.push({
      schemeId: passportScheme.id,
      schemeCode: passportScheme.code,
      identifierType: passportScheme.identifierType,
      value: passportNumber,
      normalizedValue: passportKey,
      issuingCountry: passportIssuingCountry || null,
      isPrimary: !idKey,
    });
  }

  for (const raw of customIdentifierInput) {
    if (!raw || typeof raw !== "object") {
      return NextResponse.json({ error: "invalid_custom_identifier" }, { status: 400 });
    }
    const item = raw as Record<string, unknown>;
    const schemeId = text(item.schemeId, 36);
    const value = text(item.value, 120);
    const issuingCountry = text(item.issuingCountry, 2).toUpperCase();
    if (!schemeId || !value) continue;
    if (issuingCountry && !/^[A-Z]{2}$/.test(issuingCountry)) {
      return NextResponse.json({ error: "invalid_identifier_issuing_country" }, { status: 400 });
    }
    const scheme = schemeById.get(schemeId);
    if (!scheme || scheme.identifierType !== "OTHER" || scheme.code === "LEGACY_OTHER") {
      return NextResponse.json({ error: "custom_identifier_scheme_not_available" }, { status: 409 });
    }
    if (scheme.requiresIssuingCountry && !issuingCountry) {
      return NextResponse.json({ error: "identifier_issuing_country_required", schemeId }, { status: 400 });
    }
    const normalizedValue = normalizePatientIdentifier(value);
    if (!normalizedValue) continue;
    identifierChecks.push({
      schemeId: scheme.id,
      schemeCode: scheme.code,
      identifierType: scheme.identifierType,
      value,
      normalizedValue,
      issuingCountry: issuingCountry || null,
      isPrimary: identifierChecks.length === 0,
    });
  }

  const seenIdentifiers = new Set<string>();
  for (const identifier of identifierChecks) {
    const identityKey = identifier.schemeId + ":" + identifier.normalizedValue;
    if (seenIdentifiers.has(identityKey)) {
      return NextResponse.json({ error: "duplicate_identifier_in_request", schemeCode: identifier.schemeCode }, { status: 400 });
    }
    seenIdentifiers.add(identityKey);

    const existingId = await prisma.patientIdentifier.findUnique({
      where: {
        organizationId_schemeId_normalizedValue: {
          organizationId: session.user.organizationId,
          schemeId: identifier.schemeId,
          normalizedValue: identifier.normalizedValue,
        },
      },
      include: { patient: { select: { id: true, patientNumber: true, fullNameEn: true } } },
    });
    if (existingId) {
      return NextResponse.json({
        error: "identifier_already_used",
        identifierType: identifier.identifierType,
        schemeCode: identifier.schemeCode,
        patient: existingId.patient,
      }, { status: 409 });
    }
  }

  let outcome;
  try {
    outcome = await prisma.$transaction(async (tx) => {
    // First transaction operation: locking read (not an MVCC snapshot).
    // Different request keys and different staff sessions for this same
    // organization must serialize before duplicate evidence is rechecked.
    const tenantLock = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM organizations
      WHERE id = ${session.user.organizationId} AND status = 'ACTIVE'
      FOR UPDATE
    `;
    if (tenantLock.length !== 1) return { kind: "organization_unavailable" } as const;
    // Stage 151 request replay must ALSO run after the organization lock.
    // Otherwise concurrent identical keyed requests would see each other as
    // new potential duplicate patients rather than returning the prior 201.
    if (submission.key && payloadHash) {
      const prior = await tx.patient.findFirst({
        where: {
          organizationId: session.user.organizationId,
          creationRequestUserId: session.user.id,
          creationSubmissionKey: submission.key,
        },
        select: {
          id: true, patientNumber: true, fullNameEn: true,
          status: true, mergedIntoPatientId: true, creationPayloadHash: true,
        },
      });
      const decision = evaluatePatientCreationReplay(prior, payloadHash);
      if (decision.kind === "conflict")
        return { kind: "replay_conflict" } as const;
      if (decision.kind === "record_changed")
        return { kind: "replay_record_changed" } as const;
      if (decision.kind === "replay" && prior)
        return { kind: "replayed", patient: {
          id: prior.id, patientNumber: prior.patientNumber, fullNameEn: prior.fullNameEn,
        } } as const;
    }
    // Scheme preflight outside this transaction is not authoritative. A
    // concurrent admin may soft-deactivate a custom scheme before we lock.
    // Recheck every identifier scheme under the SAME active tenant lock that
    // serializes scheme lifecycle mutations. Historical identifiers are not
    // touched when a scheme is disabled.
    if (identifierChecks.length > 0) {
      const liveSchemes = await tx.patientIdentifierScheme.findMany({
        where: {
          organizationId: session.user.organizationId,
          status: "ACTIVE",
          id: { in: [...new Set(identifierChecks.map(item => item.schemeId))] },
        },
        select: { id: true, code: true, identifierType: true, requiresIssuingCountry: true },
      });
      const currentById = new Map(liveSchemes.map(item => [item.id, item]));
      for (const identifier of identifierChecks) {
        const scheme = currentById.get(identifier.schemeId);
        if (!scheme || scheme.code !== identifier.schemeCode ||
            scheme.identifierType !== identifier.identifierType ||
            (scheme.requiresIssuingCountry && !identifier.issuingCountry)) {
          return { kind: "identifier_scheme_changed",
            schemeCode: identifier.schemeCode } as const;
        }
      }
    }
    const duplicateRows = duplicateOr.length > 0
      ? await tx.patient.findMany({
          where: {
            organizationId: session.user.organizationId,
            status: "ACTIVE", mergedIntoPatientId: null, OR: duplicateOr,
          },
          select: {
            id: true, patientNumber: true, fullNameEn: true, fullNameAr: true,
            normalizedName: true, dateOfBirth: true, phone: true, normalizedPhone: true,
          },
          take: PATIENT_DUPLICATE_REVIEW_MAX_CANDIDATES + 1,
        }) : [];
    // Never allow an override based on a truncated or stale candidate list.
    if (duplicateRows.length > PATIENT_DUPLICATE_REVIEW_MAX_CANDIDATES)
      return { kind: "duplicate_overflow" } as const;
    const duplicateCandidates = sortDuplicateCandidates(duplicateRows.map(candidate => ({
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
    })).filter(candidate => candidate.evidence.length > 0));
    if (duplicateCandidates.length > 0 && !duplicateReviewOverride) {
      return { kind: "possible_duplicates", candidates: duplicateCandidates } as const;
    }
    if (duplicateReviewOverride) {
      if (!duplicateReviewReason)
        return { kind: "duplicate_review_reason_required" } as const;
      if (!patientCandidateReviewIsCurrent(reviewedCandidateIds,
            duplicateCandidates.map(candidate => candidate.id)) || !duplicateCandidates.length)
        return { kind: "duplicate_review_candidates_changed" } as const;
    }
    // A preflight identifier lookup cannot substitute for checking inside the
    // same serialized transaction. DB unique keys also remain a last guard.
    for (const identifier of identifierChecks) {
      const existingId = await tx.patientIdentifier.findUnique({
        where: { organizationId_schemeId_normalizedValue: {
          organizationId: session.user.organizationId,
          schemeId: identifier.schemeId,
          normalizedValue: identifier.normalizedValue,
        } },
        include: { patient: { select: { id: true, patientNumber: true, fullNameEn: true } } },
      });
      if (existingId) return {
        kind: "identifier_already_used",
        identifierType: identifier.identifierType,
        schemeCode: identifier.schemeCode,
        patient: existingId.patient,
      } as const;
    }
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
        recordedAgeValue,
        recordedAgeUnit: ageUnit,
        recordedAgeAt: new Date(),
        address: address || null,
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
        creationRequestUserId: submission.key ? session.user.id : null,
        creationSubmissionKey: submission.key,
        creationPayloadHash: payloadHash,
      },
    });

    if (identifierChecks.length > 0) {
      await tx.patientIdentifier.createMany({
        data: identifierChecks.map(identifier => ({
          organizationId: session.user.organizationId,
          patientId: patient.id,
          schemeId: identifier.schemeId,
          identifierType: identifier.identifierType,
          value: identifier.value,
          normalizedValue: identifier.normalizedValue,
          issuingCountry: identifier.issuingCountry,
          isPrimary: identifier.isPrimary,
        })),
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
          identifiers: identifierChecks.map(item => ({
            schemeId: item.schemeId,
            schemeCode: item.schemeCode,
            identifierType: item.identifierType,
          })),
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

    return { kind: "created", patient } as const;
    }, { timeout: 30000 });
  } catch (error) {
    // Concurrent identical POSTs are serialized by MariaDB's unique key.
    // The loser may only recover the *same* committed submission and actor;
    // unrelated unique conflicts must retain their existing failure behavior.
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
      const prior = await replayResponse();
      if (prior) return prior;
    }
    throw error;
  }

  // Domain responses are emitted after rollback/commit, not from a partially
  // written transaction. In particular, a stale review creates no audit.
  if (outcome.kind === "replay_conflict")
    return NextResponse.json({ error: "patient_creation_submission_conflict" },
      { status: 409, headers: { "Cache-Control": "private, no-store" } });
  if (outcome.kind === "replay_record_changed")
    return NextResponse.json({ error: "patient_creation_record_changed" },
      { status: 409, headers: { "Cache-Control": "private, no-store" } });
  if (outcome.kind === "replayed")
    return NextResponse.json({ status: "ok", replayed: true, patient: outcome.patient },
      { status: 200, headers: { "Cache-Control": "private, no-store" } });
  if (outcome.kind === "organization_unavailable")
    return NextResponse.json({ error: "organization_unavailable" }, { status: 403 });
  if (outcome.kind === "duplicate_overflow")
    return NextResponse.json({ error: "duplicate_review_overflow" }, { status: 409 });
  if (outcome.kind === "possible_duplicates")
    return NextResponse.json({ error: "possible_duplicates", candidates: outcome.candidates },
      { status: 409, headers: { "Cache-Control": "private, no-store" } });
  if (outcome.kind === "duplicate_review_reason_required")
    return NextResponse.json({ error: "duplicate_review_reason_required" }, { status: 400 });
  if (outcome.kind === "duplicate_review_candidates_changed")
    return NextResponse.json({ error: "duplicate_review_candidates_changed" }, { status: 409 });
  if (outcome.kind === "identifier_scheme_changed")
    return NextResponse.json({
      error: "identifier_scheme_changed", schemeCode: outcome.schemeCode,
    }, { status: 409, headers: { "Cache-Control": "private, no-store" } });
  if (outcome.kind === "identifier_already_used")
    return NextResponse.json({
      error: "identifier_already_used",
      identifierType: outcome.identifierType,
      schemeCode: outcome.schemeCode,
      patient: outcome.patient,
    }, { status: 409 });
  return NextResponse.json({ status: "ok", patient: outcome.patient },
    { status: 201, headers: { "Cache-Control": "private, no-store" } });
}
