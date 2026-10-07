import type { Prisma, PrismaClient } from "../../generated/prisma/client";

type DbClient = PrismaClient | Prisma.TransactionClient;

function wholeYears(dob: Date, at: Date) {
  let years = at.getUTCFullYear() - dob.getUTCFullYear();
  const beforeBirthday =
    at.getUTCMonth() < dob.getUTCMonth() ||
    (at.getUTCMonth() === dob.getUTCMonth() && at.getUTCDate() < dob.getUTCDate());
  if (beforeBirthday) years--;
  return Math.max(0, years);
}

function wholeMonths(dob: Date, at: Date) {
  let months = (at.getUTCFullYear() - dob.getUTCFullYear()) * 12 + (at.getUTCMonth() - dob.getUTCMonth());
  if (at.getUTCDate() < dob.getUTCDate()) months--;
  return Math.max(0, months);
}

function ageInUnit(dob: Date, at: Date, unit: "DAY" | "WEEK" | "MONTH" | "YEAR") {
  if (unit === "YEAR") return wholeYears(dob, at);
  if (unit === "MONTH") return wholeMonths(dob, at);
  const days = Math.max(0, Math.floor((at.getTime() - dob.getTime()) / 86_400_000));
  return unit === "WEEK" ? Math.floor(days / 7) : days;
}

export async function resolveReferenceInterval(
  db: DbClient,
  input: {
    componentId: string;
    branchId: string;
    methodId?: string | null;
    patientSex: "MALE" | "FEMALE" | "UNKNOWN";
    dateOfBirth?: Date | null;
    at?: Date;
  },
) {
  const at = input.at ?? new Date();

  const intervals = await db.referenceInterval.findMany({
    where: {
      componentId: input.componentId,
      status: "ACTIVE",
      effectiveFrom: { lte: at },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: at } }],
      AND: [
        { OR: [{ branchId: null }, { branchId: input.branchId }] },
        { OR: [{ methodId: null }, ...(input.methodId ? [{ methodId: input.methodId }] : [])] },
      ],
    },
  });

  const candidates = intervals.filter((interval) => {
    if (interval.sex !== "ANY" && interval.sex !== input.patientSex) return false;

    const hasAgeBound = interval.ageFrom !== null || interval.ageTo !== null;
    if (!hasAgeBound) return true;
    if (!input.dateOfBirth || !interval.ageUnit) return false;

    const age = ageInUnit(input.dateOfBirth, at, interval.ageUnit);
    const from = interval.ageFrom === null ? null : Number(interval.ageFrom);
    const to = interval.ageTo === null ? null : Number(interval.ageTo);

    return (from === null || age >= from) && (to === null || age <= to);
  });

  return candidates
    .map((interval) => {
      const branchScore = interval.branchId === input.branchId ? 8 : 0;
      const methodScore = input.methodId && interval.methodId === input.methodId ? 4 : 0;
      const sexScore = interval.sex !== "ANY" ? 2 : 0;
      const ageScore = interval.ageFrom !== null || interval.ageTo !== null ? 1 : 0;
      return { interval, score: branchScore + methodScore + sexScore + ageScore };
    })
    .sort((a, b) => b.score - a.score || b.interval.effectiveFrom.getTime() - a.interval.effectiveFrom.getTime())[0]?.interval ?? null;
}

export function numericFlag(
  value: Prisma.Decimal,
  interval: {
    lowValue: Prisma.Decimal | null;
    highValue: Prisma.Decimal | null;
    criticalLow: Prisma.Decimal | null;
    criticalHigh: Prisma.Decimal | null;
  } | null,
) {
  if (!interval) return { flag: "UNKNOWN" as const, isAbnormal: false, isCritical: false };

  if (interval.criticalLow !== null && value.lt(interval.criticalLow)) {
    return { flag: "CRITICAL_LOW" as const, isAbnormal: true, isCritical: true };
  }
  if (interval.criticalHigh !== null && value.gt(interval.criticalHigh)) {
    return { flag: "CRITICAL_HIGH" as const, isAbnormal: true, isCritical: true };
  }
  if (interval.lowValue !== null && value.lt(interval.lowValue)) {
    return { flag: "LOW" as const, isAbnormal: true, isCritical: false };
  }
  if (interval.highValue !== null && value.gt(interval.highValue)) {
    return { flag: "HIGH" as const, isAbnormal: true, isCritical: false };
  }
  if (interval.lowValue !== null || interval.highValue !== null) {
    return { flag: "NORMAL" as const, isAbnormal: false, isCritical: false };
  }
  return { flag: "UNKNOWN" as const, isAbnormal: false, isCritical: false };
}
