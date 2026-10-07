import { Prisma, type PrismaClient } from "../../generated/prisma/client";

type DbClient = PrismaClient | Prisma.TransactionClient;

export async function evaluateDelta(
  db: DbClient,
  input: {
    organizationId: string;
    patientId: string;
    testId: string;
    componentId: string | null;
    performingBranchId: string;
    methodId?: string | null;
    currentValue: Prisma.Decimal;
    at?: Date;
  },
) {
  const at = input.at ?? new Date();

  const rules = await db.deltaRule.findMany({
    where: {
      organizationId: input.organizationId,
      testId: input.testId,
      componentId: input.componentId,
      status: "ACTIVE",
      effectiveFrom: { lte: at },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: at } }],
      AND: [
        { OR: [{ branchId: null }, { branchId: input.performingBranchId }] },
        { OR: [{ methodId: null }, ...(input.methodId ? [{ methodId: input.methodId }] : [])] },
      ],
    },
    orderBy: [{ effectiveFrom: "desc" }],
  });

  const rule = rules
    .map((candidate) => ({
      candidate,
      score:
        (candidate.branchId === input.performingBranchId ? 4 : 0) +
        (input.methodId && candidate.methodId === input.methodId ? 2 : 0),
    }))
    .sort((a, b) => b.score - a.score || b.candidate.effectiveFrom.getTime() - a.candidate.effectiveFrom.getTime())[0]?.candidate;

  if (!rule) {
    return {
      evaluation: "NOT_CONFIGURED" as const,
      previousValue: null,
      previousResultAt: null,
      deltaAbsolute: null,
      deltaPercent: null,
      absoluteLimit: null,
      percentLimit: null,
      ruleId: null,
      lookbackDays: null,
    };
  }

  const lookbackStart = new Date(at.getTime() - rule.lookbackDays * 86_400_000);

  const previous = await db.laboratoryResultValue.findFirst({
    where: {
      result: {
        organizationId: input.organizationId,
        status: "RELEASED",
        releasedAt: { gte: lookbackStart, lt: at },
        orderItem: {
          testId: input.testId,
          order: { patientId: input.patientId },
        },
      },
      ...(input.componentId
        ? { componentId: input.componentId }
        : { componentId: null, componentCodeSnapshot: { not: "" } }),
      valueNumeric: { not: null },
    },
    include: { result: true },
    orderBy: { result: { releasedAt: "desc" } },
  });

  if (!previous?.valueNumeric || !previous.result.releasedAt) {
    return {
      evaluation: "NO_PREVIOUS_RESULT" as const,
      previousValue: null,
      previousResultAt: null,
      deltaAbsolute: null,
      deltaPercent: null,
      absoluteLimit: rule.absoluteLimit,
      percentLimit: rule.percentLimit,
      ruleId: rule.id,
      lookbackDays: rule.lookbackDays,
    };
  }

  const previousValue = new Prisma.Decimal(previous.valueNumeric);
  const deltaAbsolute = input.currentValue.sub(previousValue).abs();
  const deltaPercent = previousValue.eq(0)
    ? null
    : deltaAbsolute.div(previousValue.abs()).mul(100);

  const absoluteExceeded = rule.absoluteLimit !== null && deltaAbsolute.gt(rule.absoluteLimit);
  const percentExceeded = rule.percentLimit !== null && deltaPercent !== null && deltaPercent.gt(rule.percentLimit);
  const exceeded = absoluteExceeded || percentExceeded;

  return {
    evaluation: exceeded ? "EXCEEDED" as const : "WITHIN_LIMIT" as const,
    previousValue,
    previousResultAt: previous.result.releasedAt,
    deltaAbsolute,
    deltaPercent,
    absoluteLimit: rule.absoluteLimit,
    percentLimit: rule.percentLimit,
    ruleId: rule.id,
    lookbackDays: rule.lookbackDays,
  };
}
