import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";

function text(value: unknown, max = 220) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
function normalizedName(value: string) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toUpperCase();
}
function normalizedPhone(value: string) {
  return value.replace(/[^0-9+]/g, "");
}
function normalizedIdentifier(value: string) {
  return value.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
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

  if (!fullNameEn) return NextResponse.json({ error: "name_required" }, { status: 400 });
  if (nationalityCode && !/^[A-Z]{2}$/.test(nationalityCode)) {
    return NextResponse.json({ error: "invalid_nationality_code" }, { status: 400 });
  }
  if (passportIssuingCountry && !/^[A-Z]{2}$/.test(passportIssuingCountry)) {
    return NextResponse.json({ error: "invalid_passport_issuing_country" }, { status: 400 });
  }

  const nameKey = normalizedName(fullNameEn);
  const phoneKey = phone ? normalizedPhone(phone) : null;
  const dob = dateOfBirth ? new Date(`${dateOfBirth}T00:00:00.000Z`) : null;
  if (dateOfBirth && Number.isNaN(dob?.getTime())) return NextResponse.json({ error: "invalid_date_of_birth" }, { status: 400 });

  const possibleDuplicate = await prisma.patient.findFirst({
    where: {
      organizationId: session.user.organizationId,
      normalizedName: nameKey,
      ...(dob ? { dateOfBirth: dob } : {}),
      ...(phoneKey ? { normalizedPhone: phoneKey } : {}),
      status: "ACTIVE",
    },
    select: { id: true, patientNumber: true, fullNameEn: true, dateOfBirth: true, phone: true },
  });
  if (possibleDuplicate) {
    return NextResponse.json({ error: "possible_duplicate", patient: possibleDuplicate }, { status: 409 });
  }

  const idKey = nationalId ? normalizedIdentifier(nationalId) : null;
  const passportKey = passportNumber ? normalizedIdentifier(passportNumber) : null;
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

    return patient;
  });

  return NextResponse.json({ status: "ok", patient: created }, { status: 201 });
}
