import { NextResponse } from "next/server";
import { Prisma } from "../../../../../../generated/prisma/client";
import { requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { patientMergeEligibility } from "@/lib/patient-merge";
import { patientDuplicateEvidence } from "@/lib/patient-duplicate-review";
import { consumeStaffStepUp, StaffStepUpError } from "@/lib/staff-step-up";

function text(value: unknown, max = 1000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

class PatientMergeError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

type MergeIdentityPatient = {
  patientNumber: string;
  fullNameEn: string;
  fullNameAr: string | null;
  dateOfBirth: Date | null;
  sexAtBirth: string;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  nationalityCode: string | null;
  addressEn: string | null;
  addressAr: string | null;
  creationBranchId: string | null;
  identifiers: Array<{
    identifierType: string;
    value: string;
    issuingCountry: string | null;
    isPrimary: boolean;
    scheme: {
      id: string;
      code: string;
      nameEn: string;
      nameAr: string | null;
    };
  }>;
};

function mergeIdentitySnapshot(patient: MergeIdentityPatient) {
  return {
    patientNumber: patient.patientNumber,
    fullNameEn: patient.fullNameEn,
    fullNameAr: patient.fullNameAr,
    dateOfBirth: patient.dateOfBirth?.toISOString().slice(0, 10) || null,
    sexAtBirth: patient.sexAtBirth,
    phone: patient.phone,
    whatsapp: patient.whatsapp,
    email: patient.email,
    nationalityCode: patient.nationalityCode,
    addressEn: patient.addressEn,
    addressAr: patient.addressAr,
    creationBranchId: patient.creationBranchId,
    identifiers: patient.identifiers,
  };
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("patients.merge");
  const ctx = await requestContext();
  const { id: sourcePatientId } = await params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const targetPatientId = text(body.targetPatientId, 36);
  const reason = text(body.reason, 1000);
  if (!targetPatientId || !reason) {
    return NextResponse.json({ error: "target_and_reason_required" }, { status: 400 });
  }

  try {
    const merged = await prisma.$transaction(async tx => {
      // The same ACTIVE tenant lock as patient create, master update, and
      // identifier mutation MUST precede the source/target identity snapshots.
      // Without it, an identifier can be created or retired while a merge
      // reviews eligibility and then silently misstate the merge evidence.
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM organizations
        WHERE id = ${session.user.organizationId} AND status = 'ACTIVE'
        FOR UPDATE
      `;
      if (locked.length !== 1) throw new PatientMergeError("organization_unavailable");
      const [source, target] = await Promise.all([
        tx.patient.findFirst({
          where: { id: sourcePatientId, organizationId: session.user.organizationId },
          include: {
            portalAccount: { select: { id: true } },
            mergedFrom: { select: { id: true } },
            identifiers: {
              where: { status: "ACTIVE" },
              select: {
                identifierType: true,
                value: true,
                issuingCountry: true,
                isPrimary: true,
                scheme: {
                  select: { id: true, code: true, nameEn: true, nameAr: true },
                },
              },
              orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
            },
          },
        }),
        tx.patient.findFirst({
          where: { id: targetPatientId, organizationId: session.user.organizationId },
          include: {
            portalAccount: { select: { id: true } },
            identifiers: {
              where: { status: "ACTIVE" },
              select: {
                identifierType: true,
                value: true,
                issuingCountry: true,
                isPrimary: true,
                scheme: {
                  select: { id: true, code: true, nameEn: true, nameAr: true },
                },
              },
              orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
            },
          },
        }),
      ]);

      if (!source || !target) throw new PatientMergeError("patient_not_found");
      const eligibility = patientMergeEligibility(source, target);
      if (!eligibility.ok) throw new PatientMergeError(eligibility.error);

      // A merge changes canonical identity. Revalidate the one-time proof
      // after both tenant-scoped records pass eligibility and before writes.
      const stepUp = await consumeStaffStepUp(tx, {
        token: request.headers.get("x-staff-step-up-token"),
        action: "PATIENT_MERGE",
        resourceKey: [sourcePatientId, targetPatientId].join(":"),
        sessionId: session.id,
        userId: session.user.id,
        organizationId: session.user.organizationId,
        branchId: session.activeBranchId || "",
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      });

      const mergedAt = new Date();
      const sourceIdentitySnapshot = mergeIdentitySnapshot(source);
      const targetIdentitySnapshot = mergeIdentitySnapshot(target);
      const duplicateEvidenceSnapshot = patientDuplicateEvidence(source, target);

      const claimed = await tx.patient.updateMany({
        where: {
          id: source.id,
          organizationId: session.user.organizationId,
          status: "ACTIVE",
          mergedIntoPatientId: null,
        },
        data: {
          status: "INACTIVE",
          mergedIntoPatientId: target.id,
          mergedAt,
          deactivatedAt: mergedAt,
        },
      });
      if (claimed.count !== 1) throw new PatientMergeError("merge_conflict");

      const reparentedAliases = await tx.patient.updateMany({
        where: {
          organizationId: session.user.organizationId,
          mergedIntoPatientId: source.id,
          status: "INACTIVE",
        },
        data: { mergedIntoPatientId: target.id },
      });

      let portalAccountMoved = false;
      if (source.portalAccount && !target.portalAccount) {
        const moved = await tx.portalAccount.updateMany({
          where: { id: source.portalAccount.id, patientId: source.id },
          data: { patientId: target.id },
        });
        if (moved.count !== 1) throw new PatientMergeError("portal_account_move_conflict");
        portalAccountMoved = true;
      }

      const event = await tx.patientMergeEvent.create({
        data: {
          organizationId: session.user.organizationId,
          sourcePatientId: source.id,
          targetPatientId: target.id,
          sourcePatientNumberSnapshot: source.patientNumber,
          targetPatientNumberSnapshot: target.patientNumber,
          sourceIdentitySnapshot,
          targetIdentitySnapshot,
          duplicateEvidenceSnapshot,
          reason,
          mergedByUserId: session.user.id,
          mergedAt,
        },
      });

      await tx.auditEvent.createMany({
        data: [
          {
            organizationId: session.user.organizationId,
            branchId: session.activeBranchId,
            actorUserId: session.user.id,
            action: "PATIENT_MERGED",
            entityType: "Patient",
            entityId: source.id,
            oldValues: {
              patientNumber: source.patientNumber,
              status: source.status,
              mergedIntoPatientId: source.mergedIntoPatientId,
            },
            newValues: {
              status: "INACTIVE",
              mergedIntoPatientId: target.id,
              targetPatientNumber: target.patientNumber,
              patientMergeEventId: event.id,
              reparentedAliasCount: reparentedAliases.count,
              portalAccountMoved,
              duplicateEvidenceSnapshot,
              stepUpGrantId: stepUp.grantId,
              stepUpProofMethod: stepUp.proofMethod,
            },
            reason,
            ipAddress: ctx.ipAddress,
            userAgent: ctx.userAgent,
          },
          {
            organizationId: session.user.organizationId,
            branchId: session.activeBranchId,
            actorUserId: session.user.id,
            action: "PATIENT_MERGE_RECEIVED",
            entityType: "Patient",
            entityId: target.id,
            oldValues: {
              patientNumber: target.patientNumber,
              status: target.status,
            },
            newValues: {
              sourcePatientId: source.id,
              sourcePatientNumber: source.patientNumber,
              patientMergeEventId: event.id,
              reparentedAliasCount: reparentedAliases.count,
              portalAccountMoved,
              stepUpGrantId: stepUp.grantId,
              stepUpProofMethod: stepUp.proofMethod,
            },
            reason,
            ipAddress: ctx.ipAddress,
            userAgent: ctx.userAgent,
          },
        ],
      });

      return {
        sourcePatientId: source.id,
        sourcePatientNumber: source.patientNumber,
        targetPatientId: target.id,
        targetPatientNumber: target.patientNumber,
        patientMergeEventId: event.id,
        reparentedAliasCount: reparentedAliases.count,
        portalAccountMoved,
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 30000 });

    return NextResponse.json({ status: "merged", ...merged }, { status: 201 });
  } catch (error) {
    if (error instanceof StaffStepUpError) {
      return NextResponse.json({ error: error.code }, { status: error.statusCode });
    }
    if (error instanceof PatientMergeError) {
      const status = error.code === "organization_unavailable" ? 403 : error.code === "patient_not_found" ? 404 : 409;
      return NextResponse.json({ error: error.code }, { status });
    }
    throw error;
  }
}
