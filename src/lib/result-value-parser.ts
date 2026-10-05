import { Prisma } from "../../generated/prisma/client";

export function parseResultValue(
  resultType: "NUMERIC" | "TEXT" | "QUALITATIVE" | "BOOLEAN" | "DATE",
  raw: unknown,
) {
  if (raw === null || raw === undefined || raw === "") return null;

  if (resultType === "NUMERIC") {
    const value = String(raw).trim();
    if (!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(value)) throw new Error("INVALID_NUMERIC_VALUE");
    const numeric = new Prisma.Decimal(value);
    return { valueNumeric: numeric, valueText: null, valueBoolean: null, valueDate: null, displayValue: value };
  }

  if (resultType === "BOOLEAN") {
    const normalized = typeof raw === "boolean"
      ? raw
      : String(raw).toLowerCase() === "true"
        ? true
        : String(raw).toLowerCase() === "false"
          ? false
          : null;
    if (normalized === null) throw new Error("INVALID_BOOLEAN_VALUE");
    return { valueNumeric: null, valueText: null, valueBoolean: normalized, valueDate: null, displayValue: normalized ? "True" : "False" };
  }

  if (resultType === "DATE") {
    const value = new Date(String(raw));
    if (Number.isNaN(value.getTime())) throw new Error("INVALID_DATE_VALUE");
    return { valueNumeric: null, valueText: null, valueBoolean: null, valueDate: value, displayValue: value.toISOString().slice(0, 10) };
  }

  const value = typeof raw === "string" ? raw.trim().slice(0, 1000) : String(raw).trim().slice(0, 1000);
  if (!value) return null;
  return { valueNumeric: null, valueText: value, valueBoolean: null, valueDate: null, displayValue: value };
}
