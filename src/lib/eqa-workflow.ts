export type EqaStatus = "OPEN" | "SUBMITTED" | "ASSESSED" | "CLOSED";
export type EqaAction = "CREATE_PROGRAM" | "CREATE_ROUND" | "ADD_OBSERVATION" |
  "REMOVE_OBSERVATION" | "SUBMIT_ROUND" | "ASSESS_OBSERVATION" |
  "FINALIZE_REVIEW" | "CLOSE_ROUND" | "DEACTIVATE_PROGRAM";

export class EqaWorkflowError extends Error {
  constructor(readonly code: string, readonly statusCode = 400) { super(code); }
}

const codeExpression = /^[A-Z0-9][A-Z0-9._-]{0,79}$/;
const uuidExpression = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const invalidControl = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

export function eqaText(value: unknown, max: number, required: boolean, field: string): string | null {
  if (value === null || value === undefined || value === "") {
    if (required) throw new EqaWorkflowError("missing_" + field);
    return null;
  }
  if (typeof value !== "string" || value.trim().length > max ||
      value.trim().length === 0 || invalidControl.test(value))
    throw new EqaWorkflowError("invalid_" + field);
  return value.trim();
}
export function eqaCode(value: unknown, field = "code"): string {
  const candidate = eqaText(value,80,true,field)!.toUpperCase();
  if (!codeExpression.test(candidate)) throw new EqaWorkflowError("invalid_" + field);
  return candidate;
}
export function eqaId(value: unknown, field: string): string {
  if (typeof value !== "string" || !uuidExpression.test(value))
    throw new EqaWorkflowError("invalid_" + field);
  return value;
}
export function eqaOptionalId(value: unknown, field: string): string | null {
  return value === null || value === undefined || value === "" ? null : eqaId(value,field);
}
export function eqaDueAt(value: unknown): Date | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value))
    throw new EqaWorkflowError("invalid_due_at");
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new EqaWorkflowError("invalid_due_at");
  return date;
}
export function eqaReason(value: unknown): string {
  const reason = eqaText(value,1000,true,"reason")!;
  if (reason.length < 10) throw new EqaWorkflowError("invalid_reason");
  return reason;
}
export function eqaAssessment(value: unknown): "SATISFACTORY" | "UNSATISFACTORY" | "NOT_EVALUATED" {
  if (value !== "SATISFACTORY" && value !== "UNSATISFACTORY" && value !== "NOT_EVALUATED")
    throw new EqaWorkflowError("invalid_assessment");
  return value;
}
export function eqaNextState(current: EqaStatus, action: EqaAction): EqaStatus | null {
  if (action === "SUBMIT_ROUND" && current === "OPEN") return "SUBMITTED";
  if (action === "FINALIZE_REVIEW" && current === "SUBMITTED") return "ASSESSED";
  if (action === "CLOSE_ROUND" && current === "ASSESSED") return "CLOSED";
  return null;
}
export function eqaIndependentReviewer(
  actorId: string,
  submittedById: string | null,
  authoredById?: string | null,
): boolean {
  return Boolean(submittedById) && actorId !== submittedById && actorId !== authoredById;
}
export function eqaAllReviewed(entries: Array<{ assessment: string | null }>): boolean {
  return entries.length > 0 && entries.every(entry =>
    entry.assessment === "SATISFACTORY" ||
    entry.assessment === "UNSATISFACTORY" ||
    entry.assessment === "NOT_EVALUATED");
}
