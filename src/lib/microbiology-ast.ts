/**
 * AST measurements must retain submitted decimal precision. Never round MIC
 * or inhibition-zone measurements through JS floating point, and never infer
 * susceptibility interpretations from unversioned clinical breakpoints.
 */
export function parseAstMeasurement(
  raw: unknown,
  integerDigits: number,
  fractionDigits: number,
): string | null | undefined {
  if (raw === null || raw === "") return null;
  if (typeof raw !== "number" && typeof raw !== "string") return undefined;
  if (typeof raw === "number" && !Number.isFinite(raw)) return undefined;
  const text = String(raw).trim();
  if (text.length === 0) return null;
  const valid = new RegExp(`^(?:0|[1-9][0-9]{0,${integerDigits - 1}})(?:\\.[0-9]{1,${fractionDigits}})?$`);
  if (!valid.test(text)) return undefined;
  return text;
}

export const AST_INTERPRETATIONS = ["S", "I", "R", "NON_SUSCEPTIBLE", "UNKNOWN"] as const;
export type AstInterpretation = typeof AST_INTERPRETATIONS[number];

export function parseAstInterpretation(value: unknown): AstInterpretation | null {
  return typeof value === "string" && AST_INTERPRETATIONS.some(candidate => candidate === value)
    ? value as AstInterpretation : null;
}
