import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authenticateAnalyzerBridge } from "@/lib/analyzer-auth";

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

type ObservationInput = {
  observationId?: unknown;
  barcode?: unknown;
  analyzerTestCode?: unknown;
  rawValue?: unknown;
  rawUnit?: unknown;
};

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const credential = await authenticateAnalyzerBridge(request, id);
  if (!credential) return NextResponse.json({ error: "analyzer_bridge_unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null) as {
    bridgeMessageId?: unknown;
    observations?: ObservationInput[];
  } | null;
  if (!body || !Array.isArray(body.observations)) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  if (body.observations.length === 0 || body.observations.length > 500) {
    return NextResponse.json({ error: "invalid_observation_count" }, { status: 400 });
  }

  const bridgeMessageId = text(body.bridgeMessageId, 150);
  if (!bridgeMessageId) return NextResponse.json({ error: "bridge_message_id_required" }, { status: 400 });

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

  const normalized = body.observations.map((item, index) => ({
    index,
    observationId: text(item.observationId, 150),
    barcode: text(item.barcode, 80),
    analyzerTestCode: text(item.analyzerTestCode, 120),
    rawValue: text(item.rawValue, 1000),
    rawUnit: text(item.rawUnit, 80) || null,
  }));

  if (normalized.some(item => !item.observationId || !item.barcode || !item.analyzerTestCode || !item.rawValue)) {
    return NextResponse.json({ error: "observation_required_fields_missing" }, { status: 400 });
  }
  const observationIds = normalized.map(item => item.observationId);
  if (new Set(observationIds).size !== observationIds.length) {
    return NextResponse.json({ error: "duplicate_observation_id_in_request" }, { status: 400 });
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
        effectiveFrom: { lte: now },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }],
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
          include: { orderItem: true },
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

  const processableItems = normalized.filter(item => {
    const existing = existingByObservation.get(item.observationId);
    return !existing || existing.status === "ERROR";
  });
  const duplicateObservationCount = normalized.length - processableItems.length;
  const reprocessedObservationCount = processableItems.filter(item => existingByObservation.has(item.observationId)).length;
  const newObservationCount = processableItems.length - reprocessedObservationCount;

  const staged = await prisma.$transaction(async tx => {
    const output: Array<{ observationId: string; importId: string; status: string; errorCode: string | null }> = [];
    let errorCount = 0;

    for (const item of processableItems) {
      const mapping = mappingByCode.get(item.analyzerTestCode) || null;
      const specimen = specimenByBarcode.get(item.barcode) || null;

      let errorCode: string | null = null;
      let errorText: string | null = null;
      let orderItemId: string | null = null;

      if (!mapping) {
        errorCode = "MAPPING_NOT_FOUND";
        errorText = "No active analyzer mapping exists for the analyzer test code.";
      } else if (!specimen) {
        errorCode = "SPECIMEN_NOT_FOUND";
        errorText = "No specimen matches the supplied barcode in this organization.";
      } else if (specimen.currentBranchId !== credential.analyzer.branchId) {
        errorCode = "SPECIMEN_BRANCH_MISMATCH";
        errorText = "Specimen is not currently located at the analyzer branch.";
      } else if (!["RECEIVED","IN_PROCESS"].includes(specimen.status)) {
        errorCode = "SPECIMEN_NOT_READY";
        errorText = "Specimen status is not valid for analyzer result staging.";
      } else if (mapping.analyzerUnitCode && !item.rawUnit) {
        errorCode = "ANALYZER_UNIT_MISSING";
        errorText = "The active mapping expects an analyzer unit code but the observation has no unit.";
      } else if (mapping.analyzerUnitCode && item.rawUnit !== mapping.analyzerUnitCode) {
        errorCode = "ANALYZER_UNIT_MISMATCH";
        errorText = `Expected analyzer unit ${mapping.analyzerUnitCode} but received ${item.rawUnit}.`;
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
        } else {
          orderItemId = linkedItems[0].id;
        }
      }

      const status = errorCode ? "ERROR" : "MAPPED";
      if (errorCode) errorCount++;

      const existingImport = existingByObservation.get(item.observationId);
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

    return { output, errorCount: totalErrors };
  }, { timeout: 30000 });

  return NextResponse.json({
    status: "ok",
    messageId: message.id,
    observationCount: normalized.length,
    newObservationCount,
    reprocessedObservationCount,
    duplicateObservationCount,
    errorCount: staged.errorCount,
    imports: staged.output,
  }, { status: 202 });
}
