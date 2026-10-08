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


function localDateTimeParts(at: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const map = Object.fromEntries(parts.filter(part => part.type !== "literal").map(part => [part.type, part.value]));
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
  };
}

export function localDateTimeToUtc(value: string, timeZone: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match) return null;

  const target = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: Number(match[6] || "0"),
  };
  const validity = new Date(Date.UTC(target.year, target.month - 1, target.day, target.hour, target.minute, target.second));
  if (
    validity.getUTCFullYear() !== target.year ||
    validity.getUTCMonth() + 1 !== target.month ||
    validity.getUTCDate() !== target.day ||
    validity.getUTCHours() !== target.hour ||
    validity.getUTCMinutes() !== target.minute ||
    validity.getUTCSeconds() !== target.second
  ) return null;

  let guess = validity.getTime();
  try {
    for (let iteration = 0; iteration < 4; iteration += 1) {
      const observed = localDateTimeParts(new Date(guess), timeZone);
      const observedAsUtc = Date.UTC(observed.year, observed.month - 1, observed.day, observed.hour, observed.minute, observed.second);
      const desiredAsUtc = Date.UTC(target.year, target.month - 1, target.day, target.hour, target.minute, target.second);
      const delta = desiredAsUtc - observedAsUtc;
      if (delta === 0) break;
      guess += delta;
    }

    const finalParts = localDateTimeParts(new Date(guess), timeZone);
    if (
      finalParts.year !== target.year ||
      finalParts.month !== target.month ||
      finalParts.day !== target.day ||
      finalParts.hour !== target.hour ||
      finalParts.minute !== target.minute ||
      finalParts.second !== target.second
    ) return null;

    return new Date(guess);
  } catch {
    return null;
  }
}
