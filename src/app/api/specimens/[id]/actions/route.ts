import { NextResponse } from "next/server";
import { canAccessBranch, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { specimenActionError } from "@/lib/clinical-safety";
import { receptionAssessmentError } from "@/lib/specimen-reception-policy";
import { specimenRequirementSnapshotFromDetails } from "@/lib/specimen-requirement-engine";

function text(value: unknown, max = 500) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => null) as {
    action?: "COLLECT" | "RECEIVE" | "REJECT";
    branchId?: string;
    labelAssessment?: string;
    conditionCode?: string;
    temperatureC?: string | number;
    observedContainerCode?: string;
    discrepancyText?: string;
    receptionNotes?: string;
  } | null;

  if (!body?.action) return NextResponse.json({ error: "invalid_action" }, { status: 400 });

  const permission =
    body.action === "COLLECT" ? "specimens.collect" :
    body.action === "RECEIVE" ? "specimens.receive" :
    "specimens.reject";

  const session = await requirePermission(permission);
  const ctx = await requestContext();
  if (body.action === "COLLECT") {
    return NextResponse.json({ error: "dedicated_phlebotomy_workflow_required" }, { status: 409 });
  }
  const branchId = text(body.branchId, 36) || session.activeBranchId;
  if (!branchId || !canAccessBranch(session, branchId)) {
    return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });
  }

  const specimen = await prisma.specimen.findFirst({
    where: { id, organizationId: session.user.organizationId },
    include: {
      container: true,
      events: { where: { eventType: "CREATED" }, orderBy: { occurredAt: "asc" } },
    },
  });
  if (!specimen) return NextResponse.json({ error: "specimen_not_found" }, { status: 404 });

  const lifecycleError = specimenActionError({
    status: specimen.status,
    action: body.action,
    specimenTypeConfigured: Boolean(specimen.specimenTypeId),
  });
  if (lifecycleError) {
    return NextResponse.json({ error: lifecycleError, status: specimen.status }, { status: 409 });
  }

  if (body.action === "RECEIVE") {
    const requirementSnapshot = specimen.events
      .map(event => specimenRequirementSnapshotFromDetails(event.details))
      .find(Boolean) || null;
    if (!requirementSnapshot) {
      return NextResponse.json({ error: "specimen_requirement_snapshot_missing_for_reception" }, { status: 409 });
    }
    const expectedContainerCode = requirementSnapshot.containerCode;

    const labelAssessment = text(body.labelAssessment, 30);
    const conditionCode = text(body.conditionCode, 80).toUpperCase();
    const observedContainerCode = text(body.observedContainerCode, 80) || null;
    const discrepancyText = text(body.discrepancyText, 1000) || null;
    const receptionNotes = text(body.receptionNotes, 1000) || null;
    const temperatureText = body.temperatureC == null || body.temperatureC === "" ? "" : String(body.temperatureC);

    const receptionError = receptionAssessmentError({
      labelAssessment,
      conditionCode,
      temperatureC: temperatureText,
      expectedContainerCode,
      observedContainerCode,
      discrepancyText,
    });
    if (receptionError) {
      return NextResponse.json({ error: receptionError }, { status: 400 });
    }

    const result = await prisma.$transaction(async (tx) => {
      const changed = await tx.specimen.updateMany({
        where: {
          id: specimen.id,
          status: specimen.status,
          preanalyticalVersion: specimen.preanalyticalVersion,
        },
        data: {
          status: "RECEIVED",
          preanalyticalVersion: { increment: 1 },
          currentBranchId: branchId,
          receivedByUserId: session.user.id,
          receivedAt: new Date(),
        },
      });
      if (changed.count !== 1) throw new Error("SPECIMEN_STATE_CHANGED");
      const updated = await tx.specimen.findUniqueOrThrow({ where: { id: specimen.id } });

      const assessment = await tx.specimenReceptionAssessment.create({
        data: {
          organizationId: session.user.organizationId,
          specimenId: specimen.id,
          branchId,
          receivedByUserId: session.user.id,
          barcodeSnapshot: specimen.barcode,
          expectedContainerCodeSnapshot: expectedContainerCode,
          observedContainerCode,
          labelAssessment: labelAssessment as "MATCHED" | "UNLABELED" | "MISMATCHED",
          conditionCode,
          temperatureC: temperatureText || null,
          discrepancyText,
          notes: receptionNotes,
        },
      });

      await tx.specimenEvent.create({
        data: {
          specimenId: specimen.id,
          eventType: "RECEIVED",
          branchId,
          actorUserId: session.user.id,
          fromStatus: specimen.status,
          toStatus: "RECEIVED",
          details: {
            previousBranchId: specimen.currentBranchId,
            receptionAssessmentId: assessment.id,
            labelAssessment,
            conditionCode,
            expectedContainerCode,
            observedContainerCode,
            temperatureC: temperatureText || null,
            discrepancyText,
            notes: receptionNotes,
          },
        },
      });

      await tx.auditEvent.create({
        data: {
          organizationId: session.user.organizationId,
          branchId,
          actorUserId: session.user.id,
          action: "SPECIMEN_RECEIVED",
          entityType: "Specimen",
          entityId: specimen.id,
          newValues: {
            barcode: specimen.barcode,
            status: "RECEIVED",
            currentBranchId: branchId,
            receptionAssessmentId: assessment.id,
            labelAssessment,
            conditionCode,
            expectedContainerCode,
            observedContainerCode,
            temperatureC: temperatureText || null,
            discrepancyText,
          },
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
      });

      return updated;
    });

    return NextResponse.json({ status: "ok", specimen: result });
  }

  return NextResponse.json({ error: "dedicated_rejection_workflow_required" }, { status: 409 });
}
