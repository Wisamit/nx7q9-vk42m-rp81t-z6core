import { Prisma } from "../../generated/prisma/client";

type QcGateClient = Pick<
  Prisma.TransactionClient,
  "equipment" | "qcTarget" | "qcResult" | "qcRuleViolation"
>;

export type QcGateReason = {
  code: string;
  componentId: string | null;
  targetId?: string;
  detail?: string;
};

export type QcGateDecision = {
  status: "PASS" | "WARN" | "BLOCK";
  blocking: boolean;
  warning: boolean;
  reasons: QcGateReason[];
  evaluatedTargets: Array<{
    targetId: string;
    componentId: string | null;
    qcLotId: string;
    latestQcResultId: string | null;
    latestQcStatus: "PASS" | "WARN" | "FAIL" | null;
    latestRunAt: string | null;
    validUntil: string | null;
  }>;
};

export async function resolveAnalyzerQcGate(
  client: QcGateClient,
  input: {
    analyzerId: string;
    testId: string;
    componentIds: Array<string | null>;
    asOf?: Date;
  },
): Promise<QcGateDecision> {
  const asOf = input.asOf || new Date();
  const uniqueComponents = [...new Set(input.componentIds.map(id => id || "__TEST__"))]
    .map(key => key === "__TEST__" ? null : key);
  const reasons: QcGateReason[] = [];
  const evaluatedTargets: QcGateDecision["evaluatedTargets"] = [];

  const equipment = await client.equipment.findFirst({
    where: { analyzerId: input.analyzerId },
    include: {
      downtimeEvents: { where: { status: "OPEN" }, take: 1 },
      calibrationEvents: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });

  if (!equipment) {
    reasons.push({ code: "ANALYZER_EQUIPMENT_NOT_REGISTERED", componentId: null });
    return { status: "BLOCK", blocking: true, warning: false, reasons, evaluatedTargets };
  }
  if (equipment.status !== "ACTIVE") {
    reasons.push({ code: "EQUIPMENT_NOT_ACTIVE", componentId: null, detail: equipment.status });
  }
  if (equipment.downtimeEvents.length > 0) {
    reasons.push({ code: "EQUIPMENT_DOWNTIME_OPEN", componentId: null, detail: equipment.downtimeEvents[0].id });
  }
  const latestCalibration = equipment.calibrationEvents[0] || null;
  if (latestCalibration?.status === "FAIL") {
    reasons.push({ code: "CALIBRATION_FAILED", componentId: null, detail: latestCalibration.id });
  } else if (latestCalibration?.status === "IN_PROGRESS") {
    reasons.push({ code: "CALIBRATION_IN_PROGRESS", componentId: null, detail: latestCalibration.id });
  } else if (
    latestCalibration?.status === "DUE" &&
    (!latestCalibration.dueAt || latestCalibration.dueAt <= asOf)
  ) {
    reasons.push({ code: "CALIBRATION_DUE", componentId: null, detail: latestCalibration.id });
  }

  const targets = await client.qcTarget.findMany({
    where: {
      analyzerId: input.analyzerId,
      testId: input.testId,
      status: "ACTIVE",
      effectiveFrom: { lte: asOf },
      AND: [
        { OR: [{ effectiveTo: null }, { effectiveTo: { gte: asOf } }] },
        {
          OR: uniqueComponents.map(componentId => ({ componentId })),
        },
      ],
    },
    include: { qcLot: true },
  });

  for (const componentId of uniqueComponents) {
    const componentTargets = targets.filter(target => target.componentId === componentId);
    if (componentTargets.length === 0) {
      reasons.push({ code: "QC_TARGET_NOT_CONFIGURED", componentId });
      continue;
    }

    for (const target of componentTargets) {
      if (target.qcLot.status !== "ACTIVE") {
        reasons.push({ code: "QC_LOT_NOT_ACTIVE", componentId, targetId: target.id, detail: target.qcLot.status });
      }
      if (target.qcLot.expiryDate && target.qcLot.expiryDate < asOf) {
        reasons.push({ code: "QC_LOT_EXPIRED", componentId, targetId: target.id, detail: target.qcLot.expiryDate.toISOString() });
      }

      const latest = await client.qcResult.findFirst({
        where: {
          targetId: target.id,
          run: { runAt: { lte: asOf }, status: { not: "CANCELLED" } },
        },
        include: { run: { select: { runAt: true, status: true } } },
        orderBy: { run: { runAt: "desc" } },
      });

      const validUntil = latest
        ? new Date(latest.run.runAt.getTime() + target.qcValidHours * 60 * 60_000)
        : null;

      evaluatedTargets.push({
        targetId: target.id,
        componentId,
        qcLotId: target.qcLotId,
        latestQcResultId: latest?.id || null,
        latestQcStatus: latest?.status || null,
        latestRunAt: latest?.run.runAt.toISOString() || null,
        validUntil: validUntil?.toISOString() || null,
      });

      if (!latest) {
        reasons.push({ code: "QC_RESULT_NOT_AVAILABLE", componentId, targetId: target.id });
      } else if (validUntil && validUntil < asOf) {
        reasons.push({ code: "QC_RESULT_STALE", componentId, targetId: target.id, detail: validUntil.toISOString() });
      } else if (latest.status === "FAIL") {
        reasons.push({ code: "LATEST_QC_FAILED", componentId, targetId: target.id, detail: latest.id });
      } else if (latest.status === "WARN") {
        reasons.push({ code: "LATEST_QC_WARNING", componentId, targetId: target.id, detail: latest.id });
      }
    }
  }

  const targetIds = targets.map(target => target.id);
  if (targetIds.length > 0) {
    const openViolations = await client.qcRuleViolation.findMany({
      where: {
        targetId: { in: targetIds },
        status: "OPEN",
      },
      select: { id: true, targetId: true, severity: true, ruleCode: true },
    });

    for (const violation of openViolations) {
      const target = targets.find(item => item.id === violation.targetId);
      reasons.push({
        code: violation.severity === "BLOCK" ? "OPEN_QC_BLOCKING_VIOLATION" : "OPEN_QC_WARNING_VIOLATION",
        componentId: target?.componentId || null,
        targetId: violation.targetId,
        detail: violation.ruleCode + ":" + violation.id,
      });
    }
  }

  const blockingCodes = new Set([
    "ANALYZER_EQUIPMENT_NOT_REGISTERED",
    "EQUIPMENT_NOT_ACTIVE",
    "EQUIPMENT_DOWNTIME_OPEN",
    "CALIBRATION_FAILED",
    "CALIBRATION_IN_PROGRESS",
    "CALIBRATION_DUE",
    "QC_TARGET_NOT_CONFIGURED",
    "QC_LOT_NOT_ACTIVE",
    "QC_LOT_EXPIRED",
    "QC_RESULT_NOT_AVAILABLE",
    "QC_RESULT_STALE",
    "LATEST_QC_FAILED",
    "OPEN_QC_BLOCKING_VIOLATION",
  ]);
  const warningCodes = new Set(["LATEST_QC_WARNING", "OPEN_QC_WARNING_VIOLATION"]);

  const blocking = reasons.some(reason => blockingCodes.has(reason.code));
  const warning = reasons.some(reason => warningCodes.has(reason.code));

  return {
    status: blocking ? "BLOCK" : warning ? "WARN" : "PASS",
    blocking,
    warning,
    reasons,
    evaluatedTargets,
  };
}
