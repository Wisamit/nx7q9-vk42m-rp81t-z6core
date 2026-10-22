type ResultSource = "MANUAL" | "ANALYZER" | "IMPORT" | "CALCULATED";
type ResultFlag = "NORMAL" | "LOW" | "HIGH" | "CRITICAL_LOW" | "CRITICAL_HIGH" | "ABNORMAL" | "POSITIVE" | "NEGATIVE" | "UNKNOWN";

type HoldRule = {
  condition: "ALWAYS" | "RESULT_SOURCE" | "ANY_ABNORMAL" | "ANY_CRITICAL" | "DELTA_EXCEEDED";
  resultSource: ResultSource | null;
};

type HoldValue = {
  flag: ResultFlag;
  isAbnormal: boolean;
  isCritical: boolean;
  deltaEvaluation: "NOT_CONFIGURED" | "NO_PREVIOUS_RESULT" | "WITHIN_LIMIT" | "EXCEEDED";
};

export function validationHoldMatches(rule: HoldRule, input: {
  source: ResultSource;
  values: HoldValue[];
}) {
  if (rule.condition === "ALWAYS") return true;
  if (rule.condition === "RESULT_SOURCE")
    return rule.resultSource === null || rule.resultSource === input.source;
  if (rule.condition === "ANY_CRITICAL") return input.values.some(value => value.isCritical);
  if (rule.condition === "DELTA_EXCEEDED") return input.values.some(value => value.deltaEvaluation === "EXCEEDED");
  if (rule.condition === "ANY_ABNORMAL") return input.values.some(value => value.isAbnormal);
  // An unrecognized configured condition is a review hold, never an
  // implicit fallback to an unrelated "abnormal" calculation.
  return true;
}
