export type QualitativeOptionLike = {
  id: string;
  testId: string;
  componentId: string | null;
  code: string;
  valueEn: string;
  valueAr: string | null;
  flag: "NORMAL" | "ABNORMAL" | "POSITIVE" | "NEGATIVE" | "UNKNOWN";
  isCritical: boolean;
};

export function normalizeQualitativeToken(value: unknown) {
  return typeof value === "string" ? value.trim().toLocaleLowerCase("en-US") : "";
}

export function optionAppliesToField(
  option: Pick<QualitativeOptionLike, "testId" | "componentId">,
  testId: string,
  componentId: string | null,
) {
  return option.testId === testId && option.componentId === componentId;
}

export function matchQualitativeOption(
  options: readonly QualitativeOptionLike[],
  rawValue: unknown,
) {
  const normalized = normalizeQualitativeToken(rawValue);
  if (!normalized) return null;

  return options.find((option) => {
    return [
      option.code,
      option.valueEn,
      option.valueAr || "",
    ].some((candidate) => normalizeQualitativeToken(candidate) === normalized);
  }) || null;
}

export function qualitativeFlag(
  option: Pick<QualitativeOptionLike, "flag" | "isCritical">,
) {
  return {
    flag: option.flag,
    isCritical: option.isCritical,
  };
}
