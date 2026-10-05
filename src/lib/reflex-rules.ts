import { Prisma } from "../../generated/prisma/client";

export function reflexMatches(
  operator: "LT" | "LTE" | "GT" | "GTE" | "EQ" | "NE" | "CONTAINS",
  input: {
    numericValue: Prisma.Decimal | null;
    textValue: string | null;
    displayValue: string;
  },
  threshold: {
    numericThreshold: Prisma.Decimal | null;
    textThreshold: string | null;
  },
) {
  if (["LT","LTE","GT","GTE"].includes(operator)) {
    if (input.numericValue === null || threshold.numericThreshold === null) return false;
    if (operator === "LT") return input.numericValue.lt(threshold.numericThreshold);
    if (operator === "LTE") return input.numericValue.lte(threshold.numericThreshold);
    if (operator === "GT") return input.numericValue.gt(threshold.numericThreshold);
    return input.numericValue.gte(threshold.numericThreshold);
  }

  if (operator === "CONTAINS") {
    if (!threshold.textThreshold) return false;
    const source = (input.textValue ?? input.displayValue).toLocaleLowerCase();
    return source.includes(threshold.textThreshold.toLocaleLowerCase());
  }

  if (input.numericValue !== null && threshold.numericThreshold !== null) {
    return operator === "EQ"
      ? input.numericValue.eq(threshold.numericThreshold)
      : !input.numericValue.eq(threshold.numericThreshold);
  }

  if (threshold.textThreshold === null) return false;
  const source = (input.textValue ?? input.displayValue).trim().toLocaleLowerCase();
  const target = threshold.textThreshold.trim().toLocaleLowerCase();
  return operator === "EQ" ? source === target : source !== target;
}
