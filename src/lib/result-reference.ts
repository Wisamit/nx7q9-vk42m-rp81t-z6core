import type { Prisma, PrismaClient } from "../../generated/prisma/client";

type DbClient = PrismaClient | Prisma.TransactionClient;

type PregnancyStatusValue = "UNKNOWN" | "NOT_PREGNANT" | "PREGNANT";
type SexValue = "MALE" | "FEMALE" | "UNKNOWN";

export function referencePatientSex(value: string | null | undefined): SexValue {
  return value === "MALE" || value === "FEMALE" ? value : "UNKNOWN";
}
type SexApplicabilityValue = "ANY" | "MALE" | "FEMALE";
type AgeUnitValue = "DAY" | "WEEK" | "MONTH" | "YEAR";

type NumericLike = Prisma.Decimal | number | string;

export type ReferenceIntervalContext = {
  branchId: string;
  methodId?: string | null;
  analyzerId?: string | null;
  specimenTypeId?: string | null;
  patientSex: SexValue;
  dateOfBirth?: Date | null;
  recordedAgeValue?: number | null;
  recordedAgeUnit?: string | null;
  recordedAgeAt?: Date | null;
  ageAsOf?: Date | null;
  pregnancyStatus?: PregnancyStatusValue | null;
  gestationalAgeWeeks?: NumericLike | null;
  populationCode?: string | null;
  at?: Date;
};

export type ReferenceIntervalCandidate = {
  id: string;
  branchId: string | null;
  methodId: string | null;
  analyzerId: string | null;
  specimenTypeId: string | null;
  sex: SexApplicabilityValue;
  ageFrom: NumericLike | null;
  ageTo: NumericLike | null;
  ageUnit: AgeUnitValue | null;
  pregnancyStatus: PregnancyStatusValue | null;
  gestationalAgeFromWeeks: NumericLike | null;
  gestationalAgeToWeeks: NumericLike | null;
  populationCode: string | null;
  effectiveFrom: Date;
};

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

function ageInUnit(dob: Date, at: Date, unit: AgeUnitValue) {
  if (unit === "YEAR") return wholeYears(dob, at);
  if (unit === "MONTH") return wholeMonths(dob, at);
  const days = Math.max(0, Math.floor((at.getTime() - dob.getTime()) / 86_400_000));
  return unit === "WEEK" ? Math.floor(days / 7) : days;
}

function numberValue(value: NumericLike | null | undefined) {
  if (value === null || value === undefined) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export function normalizePopulationCode(value: string | null | undefined) {
  const normalized = value?.trim().toUpperCase() || "";
  return normalized || null;
}

export function referenceIntervalMatchesContext(
  interval: ReferenceIntervalCandidate,
  input: ReferenceIntervalContext,
) {
  if (interval.branchId !== null && interval.branchId !== input.branchId) return false;
  if (interval.methodId !== null && interval.methodId !== (input.methodId || null)) return false;
  if (interval.analyzerId !== null && interval.analyzerId !== (input.analyzerId || null)) return false;
  if (interval.specimenTypeId !== null && interval.specimenTypeId !== (input.specimenTypeId || null)) return false;

  const intervalPopulation = normalizePopulationCode(interval.populationCode);
  const inputPopulation = normalizePopulationCode(input.populationCode);
  if (intervalPopulation !== null && intervalPopulation !== inputPopulation) return false;

  if (interval.sex !== "ANY" && interval.sex !== input.patientSex) return false;

  const hasAgeBound = interval.ageFrom !== null || interval.ageTo !== null;
  if (hasAgeBound) {
    if (!interval.ageUnit) return false;
    let age: number;
    if (input.dateOfBirth) {
      age = ageInUnit(input.dateOfBirth, input.ageAsOf ?? input.at ?? new Date(), interval.ageUnit);
    } else {
      // Manually reported age is not a date of birth. Only exact matching units
      // within the same recorded UTC calendar day are supported. Other cases
      // cannot establish a safe reference-interval context.
      const at = input.ageAsOf ?? input.at ?? new Date();
      const recordedAt = input.recordedAgeAt;
      if (recordedAt == null || !Number.isFinite(recordedAt.getTime()) ||
          at.getTime() < recordedAt.getTime() ||
          at.toISOString().slice(0, 10) !== recordedAt.toISOString().slice(0, 10) ||
          input.recordedAgeUnit !== interval.ageUnit ||
          input.recordedAgeValue == null ||
          !Number.isInteger(input.recordedAgeValue) || input.recordedAgeValue < 0) return false;
      age = input.recordedAgeValue;
    }
    const from = numberValue(interval.ageFrom);
    const to = numberValue(interval.ageTo);
    if ((from !== null && age < from) || (to !== null && age > to)) return false;
  }

  if (interval.pregnancyStatus !== null) {
    const pregnancyStatus = input.pregnancyStatus || "UNKNOWN";
    if (pregnancyStatus !== interval.pregnancyStatus) return false;
  }

  const hasGestationalBound =
    interval.gestationalAgeFromWeeks !== null || interval.gestationalAgeToWeeks !== null;
  if (hasGestationalBound) {
    if ((input.pregnancyStatus || "UNKNOWN") !== "PREGNANT") return false;
    const gestationalAge = numberValue(input.gestationalAgeWeeks);
    if (gestationalAge === null) return false;
    const from = numberValue(interval.gestationalAgeFromWeeks);
    const to = numberValue(interval.gestationalAgeToWeeks);
    if ((from !== null && gestationalAge < from) || (to !== null && gestationalAge > to)) return false;
  }

  return true;
}

export function referenceIntervalSpecificityScore(
  interval: ReferenceIntervalCandidate,
  input: ReferenceIntervalContext,
) {
  let score = 0;
  if (interval.branchId === input.branchId) score += 256;
  if (input.analyzerId && interval.analyzerId === input.analyzerId) score += 128;
  if (input.methodId && interval.methodId === input.methodId) score += 64;
  if (input.specimenTypeId && interval.specimenTypeId === input.specimenTypeId) score += 32;
  if (
    normalizePopulationCode(input.populationCode) &&
    normalizePopulationCode(interval.populationCode) === normalizePopulationCode(input.populationCode)
  ) score += 16;
  if (interval.pregnancyStatus !== null) score += 8;
  if (interval.gestationalAgeFromWeeks !== null || interval.gestationalAgeToWeeks !== null) score += 4;
  if (interval.sex !== "ANY") score += 2;
  if (interval.ageFrom !== null || interval.ageTo !== null) score += 1;
  return score;
}

export function selectBestReferenceInterval<T extends ReferenceIntervalCandidate>(
  intervals: T[],
  input: ReferenceIntervalContext,
) {
  return intervals
    .filter(interval => referenceIntervalMatchesContext(interval, input))
    .map(interval => ({ interval, score: referenceIntervalSpecificityScore(interval, input) }))
    .sort((a, b) =>
      b.score - a.score ||
      b.interval.effectiveFrom.getTime() - a.interval.effectiveFrom.getTime() ||
      a.interval.id.localeCompare(b.interval.id)
    )[0]?.interval ?? null;
}

export async function resolveReferenceInterval(
  db: DbClient,
  input: ReferenceIntervalContext & { componentId: string },
) {
  const at = input.at ?? new Date();
  const populationCode = normalizePopulationCode(input.populationCode);

  const intervals = await db.referenceInterval.findMany({
    where: {
      componentId: input.componentId,
      status: "ACTIVE",
      approvalStatus: "APPROVED",
      approvedAt: { not: null },
      effectiveFrom: { lte: at },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: at } }],
      AND: [
        { OR: [{ branchId: null }, { branchId: input.branchId }] },
        { OR: [{ methodId: null }, ...(input.methodId ? [{ methodId: input.methodId }] : [])] },
        { OR: [{ analyzerId: null }, ...(input.analyzerId ? [{ analyzerId: input.analyzerId }] : [])] },
        { OR: [{ specimenTypeId: null }, ...(input.specimenTypeId ? [{ specimenTypeId: input.specimenTypeId }] : [])] },
        { OR: [{ populationCode: null }, ...(populationCode ? [{ populationCode }] : [])] },
      ],
    },
  });

  return selectBestReferenceInterval(intervals, { ...input, at, populationCode });
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
