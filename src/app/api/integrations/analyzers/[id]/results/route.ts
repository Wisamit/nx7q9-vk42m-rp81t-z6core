import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { analyzerMappingTargetUnitStillMatches } from "@/lib/analyzer-mapping-governance";
import { analyzerRoutingAllowsImport } from "@/lib/analyzer-routing";
import { parseBridgeObservationSubmission } from "@/lib/analyzer-bridge-observation-boundary";
import { analyzerRawClinicalQualifierDecision } from "@/lib/analyzer-raw-clinical-qualifier-gate";
import { authenticateAnalyzerBridge } from "@/lib/analyzer-auth";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const credential = await authenticateAnalyzerBridge(request, id);
  if (!credential) return NextResponse.json({ error: "analyzer_bridge_unauthorized" }, { status: 401 });

  const parsed = parseBridgeObservationSubmission(await request.json().catch(() => null));
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  }
  const { bridgeMessageId, observations: normalized } = parsed.submission;
  const observationIds = normalized.map(item => item.observationId);

  // The exact original payload must already have passed authenticated bridge
  // intake before any normalized observation can be staged.
  const message = await prisma.analyzerMessage.findUnique({
    where: {
      analyzerId_bridgeMessageId: {
        analyzerId: credential.analyzer.id,
        bridgeMessageId,
      },
    },
  });
  if (!message) {
    return NextResponse.json({ error: "raw_analyzer_message_not_found", bridgeMessageId }, { status: 409 });
  }

  // Revalidate ORIGINAL instrument bytes independently of the bridge's
  // normalized observation. A caller must not erase HIL/OBX-8 warnings by
  // omitting them from the five-field normalized payload.
  const originalClinicalGate = analyzerRawClinicalQualifierDecision(
    message.protocol, message.rawPayload,
  );
  if (!originalClinicalGate.eligibleForStaging) {
    return NextResponse.json({
      error: "analyzer_raw_clinical_qualifier_requires_review",
      reason: originalClinicalGate.reason,
    }, { status: 409 });
  }

  const now = new Date();
  const testCodes = [...new Set(normalized.map(item => item.analyzerTestCode))];
  const barcodes = [...new Set(normalized.map(item => item.barcode))];

  const [mappings, specimens, existingImports] = await Promise.all([
    prisma.analyzerTestMapping.findMany({
      where: {
        analyzerId: credential.analyzer.id,
        analyzerTestCode: { in: testCodes },
        status: "ACTIVE",
        approvalStatus: "APPROVED",
        approvedAt: { not: null },
        effectiveFrom: { lte: now },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }],
      },
      include: {
        test: { include: { defaultUnit: true } },
        component: { include: { unit: true } },
      },
      orderBy: { effectiveFrom: "desc" },
    }),
    prisma.specimen.findMany({
      where: {
        organizationId: credential.analyzer.organizationId,
        barcode: { in: barcodes },
      },
      include: {
        orderItems: {
          where: { status: "ACTIVE" },
          include: {
            orderItem: {
              include: { analyzerRoutes: { select: { analyzerId: true } } },
            },
          },
        },
      },
    }),
    prisma.analyzerResultImport.findMany({
      where: {
        messageId: message.id,
        bridgeObservationId: { in: observationIds },
      },
    }),
  ]);

  const existingByObservation = new Map(existingImports.map(item => [item.bridgeObservationId, item]));
  for (const item of normalized) {
    const existing = existingByObservation.get(item.observationId);
    if (!existing) continue;
    if (
      existing.barcodeSnapshot !== item.barcode ||
      existing.analyzerTestCode !== item.analyzerTestCode ||
      existing.rawValue !== item.rawValue ||
      (existing.rawUnit || null) !== item.rawUnit
    ) {
      return NextResponse.json({
        error: "bridge_observation_id_payload_conflict",
        observationId: item.observationId,
        importId: existing.id,
      }, { status: 409 });
    }
  }

  const specimenByBarcode = new Map(specimens.map(item => [item.barcode, item]));
  const mappingByCode = new Map<string, typeof mappings[number]>();
  for (const mapping of mappings) {
    if (!mappingByCode.has(mapping.analyzerTestCode)) mappingByCode.set(mapping.analyzerTestCode, mapping);
  }

  const staged = await prisma.$transaction(async tx => {
    // Lock the parent before reading child imports. Concurrent retries for the
    // same bridge message must be idempotent even when both read "not found".
    const messageLock = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM analyzer_messages
      WHERE id = ${message.id} AND analyzer_id = ${credential.analyzer.id}
      FOR UPDATE
    `;
    if (messageLock.length !== 1) throw new Error("BRIDGE_MESSAGE_STATE_CHANGED");
    const freshImports = await tx.analyzerResultImport.findMany({
      where: { messageId: message.id, bridgeObservationId: { in: observationIds } },
    });
    const liveByObservation = new Map(freshImports.map(item => [item.bridgeObservationId, item]));
    for (const item of normalized) {
      const previous = liveByObservation.get(item.observationId);
      if (previous && (
        previous.barcodeSnapshot !== item.barcode
        || previous.analyzerTestCode !== item.analyzerTestCode
        || previous.rawValue !== item.rawValue
        || (previous.rawUnit || null) !== item.rawUnit
      )) throw new Error("BRIDGE_OBSERVATION_PAYLOAD_CHANGED");
    }
    const processableItems = normalized.filter(item => {
      const existing = liveByObservation.get(item.observationId);
      return !existing || existing.status === "ERROR";
    });
    const duplicateObservationCount = normalized.length - processableItems.length;
    const reprocessedObservationCount = processableItems.filter(item => liveByObservation.has(item.observationId)).length;
    const newObservationCount = processableItems.length - reprocessedObservationCount;

    // Lock actual physical custody before staging. A quarantined or
    // transferred specimen cannot be silently restored by stale preflight.
    const lockedCustody = new Map<string, { status: string; current_branch_id: string | null }>();
    for (const specimenId of [...new Set(specimens.map(item => item.id))].sort()) {
      const rows = await tx.$queryRaw<Array<{ status: string; current_branch_id: string | null }>>`
        SELECT status,current_branch_id FROM specimens
        WHERE id = ${specimenId} AND organization_id = ${credential.analyzer.organizationId}
        FOR UPDATE
      `;
      if (rows.length === 1) lockedCustody.set(specimenId, rows[0]);
    }
    const output: Array<{ observationId: string; importId: string; status: string; errorCode: string | null }> = [];
    const claimedSpecimenIds = new Set<string>();
    let errorCount = 0;

    for (const item of processableItems) {
      const mapping = mappingByCode.get(item.analyzerTestCode) || null;
      const specimen = specimenByBarcode.get(item.barcode) || null;

      let errorCode: string | null = null;
      let errorText: string | null = null;
      let orderItemId: string | null = null;

      if (!mapping) {
        errorCode = "MAPPING_NOT_FOUND";
        errorText = "No approved active analyzer mapping exists for the analyzer test code.";
      } else if (!analyzerMappingTargetUnitStillMatches(
        mapping,
        mapping.componentId ? mapping.component?.unit || null : mapping.test.defaultUnit,
      )) {
        errorCode = "MAPPING_TARGET_UNIT_CHANGED";
        errorText = "The approved analyzer mapping no longer matches the current LIS target unit configuration.";
      } else if (!specimen) {
        errorCode = "SPECIMEN_NOT_FOUND";
        errorText = "No specimen matches the supplied barcode in this organization.";
      } else if (lockedCustody.get(specimen.id)?.current_branch_id !== credential.analyzer.branchId) {
        errorCode = "SPECIMEN_BRANCH_MISMATCH";
        errorText = "Specimen is not currently located at the analyzer branch.";
      } else if (!["RECEIVED","IN_PROCESS"].includes(lockedCustody.get(specimen.id)?.status || "")) {
        errorCode = "SPECIMEN_NOT_READY";
        errorText = "Specimen status is not valid for analyzer result staging.";
      } else if (lockedCustody.get(specimen.id)?.status !== specimen.status) {
        errorCode = "SPECIMEN_PREANALYTICAL_STATE_CHANGED";
        errorText = "Specimen custody changed during analyzer normalization.";
      } else if (mapping.analyzerUnitCode && !item.rawUnit) {
        errorCode = "ANALYZER_UNIT_MISSING";
        errorText = "The active mapping expects an analyzer unit code but the observation has no unit.";
      } else if (mapping.analyzerUnitCode && item.rawUnit !== mapping.analyzerUnitCode) {
        errorCode = "ANALYZER_UNIT_MISMATCH";
        errorText = `Expected analyzer unit ${mapping.analyzerUnitCode} but received ${item.rawUnit}.`;
      } else if (!mapping.analyzerUnitCode && item.rawUnit) {
        errorCode = "ANALYZER_UNIT_UNEXPECTED";
        errorText = "The approved LIS target is unitless but the analyzer supplied a unit.";
      } else {
        const linkedItems = specimen.orderItems
          .map(link => link.orderItem)
          .filter(orderItem => orderItem.testId === mapping.testId && orderItem.status !== "CANCELLED");

        if (linkedItems.length === 0) {
          errorCode = "ORDER_ITEM_NOT_FOUND_FOR_SPECIMEN";
          errorText = "The specimen is not linked to a non-cancelled order item for the mapped LIS test.";
        } else if (linkedItems.length > 1) {
          errorCode = "AMBIGUOUS_ORDER_ITEM";
          errorText = "More than one order item matches the mapped LIS test for this specimen.";
        } else if (!analyzerRoutingAllowsImport(
          linkedItems[0].analyzerRoutes.map(route => route.analyzerId),
          credential.analyzer.id,
        )) {
          errorCode = "ANALYZER_NOT_ROUTED_TO_ORDER_ITEM";
          errorText = "This work item is explicitly routed to a different analyzer.";
        } else {
          orderItemId = linkedItems[0].id;

          if (specimen.status === "RECEIVED" && !claimedSpecimenIds.has(specimen.id)) {
            const claimed = await tx.specimen.updateMany({
              where: {
                id: specimen.id,
                status: "RECEIVED",
                currentBranchId: credential.analyzer.branchId,
                preanalyticalVersion: specimen.preanalyticalVersion,
                orderItems: { some: { orderItemId, status: "ACTIVE" } },
              },
              data: {
                status: "IN_PROCESS",
                preanalyticalVersion: { increment: 1 },
              },
            });
            if (claimed.count !== 1) {
              errorCode = "SPECIMEN_PREANALYTICAL_STATE_CHANGED";
              errorText = "Specimen state or test linkage changed while analyzer observations were being staged.";
              orderItemId = null;
            } else {
              claimedSpecimenIds.add(specimen.id);
              await tx.specimenEvent.create({
                data: {
                  specimenId: specimen.id,
                  eventType: "PROCESSING_STARTED",
                  branchId: credential.analyzer.branchId,
                  actorUserId: null,
                  fromStatus: "RECEIVED",
                  toStatus: "IN_PROCESS",
                  details: {
                    workflow: "ANALYZER_STAGING",
                    analyzerId: credential.analyzer.id,
                    messageId: message.id,
                  },
                },
              });
            }
          }
        }
      }

      const status = errorCode ? "ERROR" : "MAPPED";
      if (errorCode) errorCount++;

      const existingImport = liveByObservation.get(item.observationId);
      const savedImport = existingImport
        ? await tx.analyzerResultImport.update({
            where: { id: existingImport.id },
            data: {
              mappingId: mapping?.id || null,
              orderItemId,
              specimenId: specimen?.id || null,
              status,
              errorCode,
              errorText,
            },
          })
        : await tx.analyzerResultImport.create({
            data: {
              messageId: message.id,
              bridgeObservationId: item.observationId,
              analyzerId: credential.analyzer.id,
              mappingId: mapping?.id || null,
              orderItemId,
              specimenId: specimen?.id || null,
              barcodeSnapshot: item.barcode,
              analyzerTestCode: item.analyzerTestCode,
              rawValue: item.rawValue,
              rawUnit: item.rawUnit,
              status,
              errorCode,
              errorText,
            },
          });
      output.push({ observationId: item.observationId, importId: savedImport.id, status, errorCode });
    }

    const allRows = await tx.analyzerResultImport.findMany({ where: { messageId: message.id } });
    const totalErrors = allRows.filter(item => item.status === "ERROR").length;

    await tx.analyzerMessage.update({
      where: { id: message.id },
      data: {
        status: totalErrors > 0 ? "ERROR" : "PROCESSED",
        attempts: { increment: 1 },
        errorCode: totalErrors > 0 ? "RESULT_STAGING_ERRORS" : null,
        errorText: totalErrors > 0 ? `${totalErrors} normalized observation(s) require review.` : null,
        processedAt: new Date(),
      },
    });

    await tx.auditEvent.create({
      data: {
        organizationId: credential.analyzer.organizationId,
        branchId: credential.analyzer.branchId,
        actorUserId: null,
        action: "ANALYZER_RESULTS_STAGED",
        entityType: "AnalyzerMessage",
        entityId: message.id,
        newValues: {
          analyzerId: credential.analyzer.id,
          bridgeMessageId,
          receivedObservationCount: normalized.length,
          newObservationCount,
          reprocessedObservationCount,
          duplicateObservationCount,
          errorCount: totalErrors,
          credentialId: credential.id,
        },
        reason: "Normalized Analyzer Bridge observations staged for LIS import review",
      },
    });

    return { output, errorCount: totalErrors, newObservationCount, reprocessedObservationCount, duplicateObservationCount };
  }, { timeout: 30000 }).catch(error => {
    if (error instanceof Error && ["BRIDGE_MESSAGE_STATE_CHANGED","BRIDGE_OBSERVATION_PAYLOAD_CHANGED"].includes(error.message)) return null;
    throw error;
  });
  if (!staged) {
    return NextResponse.json({ error: "bridge_observation_state_or_payload_conflict" }, { status: 409 });
  }

  return NextResponse.json({
    status: "ok",
    messageId: message.id,
    observationCount: normalized.length,
    newObservationCount: staged.newObservationCount,
    reprocessedObservationCount: staged.reprocessedObservationCount,
    duplicateObservationCount: staged.duplicateObservationCount,
    errorCount: staged.errorCount,
    imports: staged.output,
  }, { status: 202 });
}
