type ResultSource = "MANUAL" | "ANALYZER" | "IMPORT" | "CALCULATED";
type ResultFlag = "NORMAL" | "LOW" | "HIGH" | "CRITICAL_LOW" | "CRITICAL_HIGH" | "ABNORMAL" | "POSITIVE" | "NEGATIVE" | "UNKNOWN";

type ValueForAutoverification = {
  flag: ResultFlag;
  isAbnormal: boolean;
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
  qcGate?: {
    status: "PASS" | "WARN" | "BLOCK";
    reasons: Array<{ code: string; detail?: string }>;
  } | null;
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
    // Unknown analyzer-derived LIS flags have not been qualified by a
    // validated reference/qualitative context. Never infer that they are
    // safe merely because an optional "all normal" switch is disabled.
    if (input.source === "ANALYZER" && input.values.some(value => value.flag === "UNKNOWN"))
      reasons.push("ANALYZER_UNCLASSIFIED_RESULT_REQUIRES_REVIEW");
    // A configured Delta rule without a comparable prior observation is NOT
    // evidence that the current value is within the approved limit.
    // Preserve the strict EXCEEDED block even if a legacy policy lacks the
    // corresponding flag. Unconfigured Delta (NOT_CONFIGURED) is not a failed
    // comparison and remains separately governed by rule configuration.
    if (input.values.some(value => value.deltaEvaluation === "EXCEEDED"))
      reasons.push("DELTA_LIMIT_EXCEEDED");
    if (policy.requireDeltaWithinLimit &&
        input.values.some(value => value.deltaEvaluation === "NO_PREVIOUS_RESULT"))
      reasons.push("DELTA_COMPARABLE_BASELINE_REQUIRED");
    if (input.pendingReflexCount > 0) reasons.push("PENDING_REFLEX_RECOMMENDATION");
    if (input.blockingHoldCount > 0) reasons.push("BLOCKING_VALIDATION_HOLD");
    if (input.source === "ANALYZER") {
      if (!input.qcGate) {
        reasons.push("ANALYZER_QC_GATE_NOT_EVALUATED");
      } else if (input.qcGate.status === "BLOCK") {
        reasons.push("ANALYZER_QC_BLOCKED");
        for (const reason of input.qcGate.reasons) reasons.push("QC:" + reason.code);
      } else if (input.qcGate.status === "WARN") {
        reasons.push("ANALYZER_QC_WARNING_REQUIRES_REVIEW");
        for (const reason of input.qcGate.reasons) reasons.push("QC:" + reason.code);
      }
    }
    if (policy.requireAllFlagsNormal && input.values.some(value => value.isAbnormal)) {
      reasons.push("NON_NORMAL_FLAG_PRESENT");
    }
  }

  return {
    eligible: reasons.length === 0,
    policyId: policy?.id || null,
    reasons,
    qcGate: input.qcGate || null,
  };
}
