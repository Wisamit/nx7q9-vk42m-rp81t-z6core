/**
 * Analyzer transport is at-least-once. Every command uses an immutable ID and
 * a fresh lease token; the device bridge must deduplicate by workOrderId.
 */
export function analyzerRetryDelaySeconds(attempt: number): number {
  const bounded = Math.max(0, Math.min(7, Math.floor(attempt) - 1));
  return Math.min(3600, 30 * 2 ** bounded);
}

export function analyzerWorkOrderClinicalEligibility(input: {
  specimenStatus: string;
  currentBranchId: string | null;
  analyzerBranchId: string;
  orderItemStatus: string;
  resultStatuses: string[];
  validationStages: string[];
}): "READY" | "SPECIMEN_UNREADY" | "ORDER_CANCELLED" | "RESULT_LOCKED" {
  if (!["RECEIVED", "IN_PROCESS"].includes(input.specimenStatus) ||
    input.currentBranchId !== input.analyzerBranchId) return "SPECIMEN_UNREADY";
  if (input.orderItemStatus === "CANCELLED") return "ORDER_CANCELLED";
  if (input.resultStatuses.some(status => ["VERIFIED","RELEASED","AMENDED","CANCELLED"].includes(status)) ||
    input.validationStages.includes("COMPLETE")) return "RESULT_LOCKED";
  return "READY";
}
