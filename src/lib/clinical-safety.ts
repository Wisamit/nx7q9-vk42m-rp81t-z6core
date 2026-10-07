export type SpecimenLifecycleStatus =
  | "PLANNED"
  | "COLLECTION_FAILED"
  | "COLLECTED"
  | "RECEIVED"
  | "IN_TRANSIT"
  | "IN_PROCESS"
  | "REJECTED"
  | "DISPOSED";

export type SpecimenLifecycleAction = "COLLECT" | "RECEIVE" | "REJECT";

export function specimenActionError(input: {
  status: SpecimenLifecycleStatus;
  action: SpecimenLifecycleAction;
  specimenTypeConfigured: boolean;
}) {
  if (input.action === "COLLECT") {
    if (input.status !== "PLANNED") return "specimen_not_collectable";
    if (!input.specimenTypeConfigured) return "specimen_type_required_before_collection";
    return null;
  }

  if (input.action === "RECEIVE") {
    return ["COLLECTED", "IN_TRANSIT"].includes(input.status) ? null : "specimen_not_receivable";
  }

  return ["COLLECTED", "RECEIVED"].includes(input.status) ? null : "specimen_not_rejectable";
}

export function releaseEligibility(input: {
  resultStatus: string;
  qcBlocking: boolean;
  criticalCount: number;
  criticalEventStatus: string | null;
}) {
  if (input.resultStatus !== "VERIFIED") {
    return { allowed: false, error: "result_not_releasable" as const };
  }
  if (input.qcBlocking) {
    return { allowed: false, error: "qc_release_blocked" as const };
  }
  if (input.criticalCount > 0 && input.criticalEventStatus !== "ACKNOWLEDGED") {
    return { allowed: false, error: "critical_acknowledgement_required" as const };
  }
  return { allowed: true, error: null };
}

export function amendmentEligibility(input: {
  resultStatus: string;
  hasMicrobiologySnapshot: boolean;
  newerResultExists: boolean;
}) {
  if (input.resultStatus !== "RELEASED") {
    return { allowed: false, error: "only_released_results_can_be_amended" as const };
  }
  if (input.hasMicrobiologySnapshot) {
    return { allowed: false, error: "microbiology_requires_dedicated_amendment_workflow" as const };
  }
  if (input.newerResultExists) {
    return { allowed: false, error: "newer_result_version_already_exists" as const };
  }
  return { allowed: true, error: null };
}

export function branchScopeAllows(authorizedBranchIds: readonly string[], branchId: string | null | undefined) {
  return Boolean(branchId && authorizedBranchIds.includes(branchId));
}

export function departmentScopeAllows(
  authorizedDepartmentIds: readonly string[],
  departmentId: string | null | undefined,
) {
  if (authorizedDepartmentIds.length === 0) return true;
  return Boolean(departmentId && authorizedDepartmentIds.includes(departmentId));
}
