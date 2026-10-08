/**
 * Validation must operate only on a specimen still physically available at the
 * performing branch. Stale worklist/review pages cannot authorize processing.
 */
export function validationSpecimenCustodyError(input: {
  status: string;
  currentBranchId: string | null;
  performingBranchId: string;
}): "specimen_not_ready_for_validation" | "specimen_performing_branch_mismatch" | null {
  if (input.status !== "RECEIVED" && input.status !== "IN_PROCESS") {
    return "specimen_not_ready_for_validation";
  }
  if (!input.currentBranchId || input.currentBranchId !== input.performingBranchId) {
    return "specimen_performing_branch_mismatch";
  }
  return null;
}
