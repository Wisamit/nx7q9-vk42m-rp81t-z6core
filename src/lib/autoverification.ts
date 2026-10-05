import { ResultFlag, ResultSource } from "../../generated/prisma/client";

type ValueForAutoverification = {
  flag: ResultFlag;
  isCritical: boolean;
  deltaEvaluation: "NOT_CONFIGURED" | "NO_PREVIOUS_RESULT" | "WITHIN_LIMIT" | "EXCEEDED";
};

type Policy = {
  id: string;
  enabled: boolean;
  allowManual: boolean;
  allowAnalyzer: boolean;
  allowImport: boolean;
  requireNoCritical: boolean;
  requireDeltaWithinLimit: boolean;
  requireNoPendingReflex: boolean;
  requireNoBlockingHolds: boolean;
  requireAllFlagsNormal: boolean;
};

export function evaluateAutoverification(input: {
  policy: Policy | null;
  source: ResultSource;
  complete: boolean;
  values: ValueForAutoverification[];
  pendingReflexCount: number;
  blockingHoldCount: number;
}) {
  const reasons: string[] = [];
  const policy = input.policy;

  if (!policy) reasons.push("NO_ACTIVE_POLICY");
  else if (!policy.enabled) reasons.push("POLICY_DISABLED");

  if (!input.complete) reasons.push("RESULT_INCOMPLETE");

  if (policy) {
    const sourceAllowed =
      (input.source === "MANUAL" && policy.allowManual) ||
      (input.source === "ANALYZER" && policy.allowAnalyzer) ||
      (input.source === "IMPORT" && policy.allowImport) ||
      input.source === "CALCULATED";

    if (!sourceAllowed) reasons.push("RESULT_SOURCE_NOT_ALLOWED");
    if (input.values.some(value => value.isCritical)) reasons.push("CRITICAL_VALUE_PRESENT");
    if (input.values.some(value => value.deltaEvaluation === "EXCEEDED")) reasons.push("DELTA_LIMIT_EXCEEDED");
    if (input.pendingReflexCount > 0) reasons.push("PENDING_REFLEX_RECOMMENDATION");
    if (input.blockingHoldCount > 0) reasons.push("BLOCKING_VALIDATION_HOLD");
    if (input.source === "ANALYZER") reasons.push("ANALYZER_QC_GATE_NOT_AVAILABLE");
    if (policy.requireAllFlagsNormal && input.values.some(value => !["NORMAL", "UNKNOWN"].includes(value.flag))) {
      reasons.push("NON_NORMAL_FLAG_PRESENT");
    }
  }

  return {
    eligible: reasons.length === 0,
    policyId: policy?.id || null,
    reasons,
  };
}
