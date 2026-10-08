import type { Prisma, PrismaClient } from "../../generated/prisma/client";

type DbClient = PrismaClient | Prisma.TransactionClient;

type DeltaReviewValue = {
  componentCodeSnapshot: string;
  componentNameEnSnapshot: string;
  componentNameArSnapshot: string | null;
  valueNumeric: Prisma.Decimal | null;
  deltaEvaluation: "NOT_CONFIGURED" | "NO_PREVIOUS_RESULT" | "WITHIN_LIMIT" | "EXCEEDED";
  previousValueSnapshot: Prisma.Decimal | null;
  previousResultAtSnapshot: Date | null;
  deltaAbsoluteSnapshot: Prisma.Decimal | null;
  deltaPercentSnapshot: Prisma.Decimal | null;
  deltaAbsoluteLimitSnapshot: Prisma.Decimal | null;
  deltaPercentLimitSnapshot: Prisma.Decimal | null;
  deltaRuleId: string | null;
  deltaLookbackDaysSnapshot: number | null;
};

export function deltaReviewRequired(value: Pick<DeltaReviewValue, "deltaEvaluation" | "valueNumeric">) {
  return value.deltaEvaluation === "EXCEEDED" && value.valueNumeric !== null;
}

export function deltaReviewSnapshot(
  value: DeltaReviewValue,
  context: {
    performingBranchId: string;
    methodId: string | null;
  },
) {
  if (!deltaReviewRequired(value)) return null;

  return {
    deltaRuleId: value.deltaRuleId,
    componentCodeSnapshot: value.componentCodeSnapshot,
    componentNameEnSnapshot: value.componentNameEnSnapshot,
    componentNameArSnapshot: value.componentNameArSnapshot,
    currentValueSnapshot: value.valueNumeric!,
    previousValueSnapshot: value.previousValueSnapshot,
    previousResultAtSnapshot: value.previousResultAtSnapshot,
    deltaAbsoluteSnapshot: value.deltaAbsoluteSnapshot,
    deltaPercentSnapshot: value.deltaPercentSnapshot,
    absoluteLimitSnapshot: value.deltaAbsoluteLimitSnapshot,
    percentLimitSnapshot: value.deltaPercentLimitSnapshot,
    lookbackDaysSnapshot: value.deltaLookbackDaysSnapshot,
    performingBranchIdSnapshot: context.performingBranchId,
    methodIdSnapshot: context.methodId,
  };
}

export async function syncDeltaReviewEvents(
  db: DbClient,
  input: {
    resultId: string;
    performingBranchId: string;
    methodId: string | null;
    detectedAt?: Date;
  },
) {
  const detectedAt = input.detectedAt ?? new Date();
  const values = await db.laboratoryResultValue.findMany({
    where: { resultId: input.resultId },
    select: {
      componentCodeSnapshot: true,
      componentNameEnSnapshot: true,
      componentNameArSnapshot: true,
      valueNumeric: true,
      deltaEvaluation: true,
      previousValueSnapshot: true,
      previousResultAtSnapshot: true,
      deltaAbsoluteSnapshot: true,
      deltaPercentSnapshot: true,
      deltaAbsoluteLimitSnapshot: true,
      deltaPercentLimitSnapshot: true,
      deltaRuleId: true,
      deltaLookbackDaysSnapshot: true,
    },
  });

  const currentCodes = values.map(value => value.componentCodeSnapshot);
  if (currentCodes.length === 0) {
    await db.deltaReviewEvent.updateMany({
      where: { resultId: input.resultId, status: "PENDING" },
      data: { status: "SUPERSEDED", supersededAt: detectedAt },
    });
    return { pendingCount: 0 };
  }

  for (const value of values) {
    const snapshot = deltaReviewSnapshot(value, input);
    if (snapshot) {
      await db.deltaReviewEvent.upsert({
        where: {
          resultId_componentCodeSnapshot: {
            resultId: input.resultId,
            componentCodeSnapshot: value.componentCodeSnapshot,
          },
        },
        update: {
          status: "PENDING",
          ...snapshot,
          detectedAt,
          acknowledgedByUserId: null,
          acknowledgedAt: null,
          acknowledgementNote: null,
          supersededAt: null,
        },
        create: {
          resultId: input.resultId,
          status: "PENDING",
          ...snapshot,
          detectedAt,
        },
      });
    } else {
      await db.deltaReviewEvent.updateMany({
        where: {
          resultId: input.resultId,
          componentCodeSnapshot: value.componentCodeSnapshot,
          status: "PENDING",
        },
        data: { status: "SUPERSEDED", supersededAt: detectedAt },
      });
    }
  }

  await db.deltaReviewEvent.updateMany({
    where: {
      resultId: input.resultId,
      status: "PENDING",
      componentCodeSnapshot: { notIn: currentCodes },
    },
    data: { status: "SUPERSEDED", supersededAt: detectedAt },
  });

  const pendingCount = await db.deltaReviewEvent.count({
    where: { resultId: input.resultId, status: "PENDING" },
  });
  return { pendingCount };
}
