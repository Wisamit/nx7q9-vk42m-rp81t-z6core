import { minorToMoney4, money4ToMinor } from "./billing-adjustments.ts";

export type ClientCreditMode = "DISABLED" | "WARN" | "BLOCK";
export type ClientCreditDecision = {
  mode: ClientCreditMode;
  limitAmount: string;
  exposureBefore: string;
  newInvoiceAmount: string;
  projectedExposure: string;
  exceeded: boolean;
  decision: "DISABLED" | "WITHIN_LIMIT" | "WARN_EXCEEDED" | "BLOCKED";
};

export function creditLimitDecision(input: {
  mode: ClientCreditMode;
  limitAmount: string;
  exposureBefore: string;
  newInvoiceAmount: string;
}): ClientCreditDecision | null {
  const limit = money4ToMinor(input.limitAmount);
  const exposure = money4ToMinor(input.exposureBefore);
  const amount = money4ToMinor(input.newInvoiceAmount);
  if (limit === null || exposure === null || amount === null ||
    limit < BigInt(0) || exposure < BigInt(0) || amount < BigInt(0)) return null;
  const projected = exposure + amount;
  const exceeded = projected > limit;
  return {
    mode: input.mode,
    limitAmount: minorToMoney4(limit),
    exposureBefore: minorToMoney4(exposure),
    newInvoiceAmount: minorToMoney4(amount),
    projectedExposure: minorToMoney4(projected),
    exceeded,
    decision: input.mode === "DISABLED" ? "DISABLED" :
      !exceeded ? "WITHIN_LIMIT" : input.mode === "WARN" ? "WARN_EXCEEDED" : "BLOCKED",
  };
}

export function validCreditLimit(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const original = String(value);
  const amount = money4ToMinor(original);
  if (amount === null || amount < BigInt(0) || amount > BigInt("9999999999999999999999")) return null;
  return minorToMoney4(amount);
}
