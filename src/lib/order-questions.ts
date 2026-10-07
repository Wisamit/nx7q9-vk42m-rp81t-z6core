export type OrderQuestionChoice = {
  code: string;
  valueEn: string;
  valueAr: string | null;
};

function clean(value: unknown, max = 500) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export function normalizeChoiceCode(value: unknown) {
  return clean(value, 100)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 100);
}

export function normalizeOrderQuestionOptions(raw: unknown): OrderQuestionChoice[] {
  if (!Array.isArray(raw)) return [];

  const result: OrderQuestionChoice[] = [];
  const used = new Set<string>();

  for (const item of raw) {
    if (typeof item === "string") {
      const valueEn = clean(item);
      if (!valueEn) continue;
      const code = normalizeChoiceCode(valueEn) || "OPTION_" + (result.length + 1);
      if (used.has(code)) continue;
      used.add(code);
      result.push({ code, valueEn, valueAr: null });
      continue;
    }

    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const valueEn = clean(record.valueEn);
    const valueAr = clean(record.valueAr) || null;
    const code = normalizeChoiceCode(record.code || valueEn);
    if (!code || !valueEn || used.has(code)) continue;
    used.add(code);
    result.push({ code, valueEn, valueAr });
  }

  return result;
}

export function parseConfiguredChoiceRows(raw: unknown): OrderQuestionChoice[] {
  return normalizeOrderQuestionOptions(raw).slice(0, 100);
}

export function orderQuestionIsEffective(
  question: {
    status: "ACTIVE" | "INACTIVE";
    effectiveFrom: Date;
    effectiveTo: Date | null;
  },
  at: Date,
) {
  return question.status === "ACTIVE"
    && question.effectiveFrom <= at
    && (question.effectiveTo === null || question.effectiveTo >= at);
}

export function nextQuestionVersion(
  existing: Array<{ version: number; effectiveFrom: Date }>,
  effectiveFrom: Date,
) {
  if (existing.length === 0) return { version: 1, supersedesVersion: null as number | null };

  const latest = [...existing].sort((a, b) =>
    b.version - a.version || b.effectiveFrom.getTime() - a.effectiveFrom.getTime()
  )[0];

  if (effectiveFrom <= latest.effectiveFrom) {
    throw new Error("QUESTION_REVISION_MUST_START_AFTER_PREVIOUS_VERSION");
  }

  return {
    version: latest.version + 1,
    supersedesVersion: latest.version,
  };
}
