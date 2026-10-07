import test from "node:test";
import assert from "node:assert/strict";
import {
  matchQualitativeOption,
  optionAppliesToField,
  qualitativeFlag,
} from "../src/lib/qualitative-result-options.ts";
import { validationHoldMatches } from "../src/lib/validation-holds.ts";
import { evaluateAutoverification } from "../src/lib/autoverification.ts";

const options = [
  {
    id: "positive",
    testId: "T1",
    componentId: null,
    code: "POS",
    valueEn: "Positive",
    valueAr: "إيجابي",
    flag: "POSITIVE" as const,
    isAbnormal: true,
    isCritical: false,
  },
  {
    id: "negative",
    testId: "T1",
    componentId: null,
    code: "NEG",
    valueEn: "Negative",
    valueAr: "سلبي",
    flag: "NEGATIVE" as const,
    isAbnormal: false,
    isCritical: false,
  },
];

test("qualitative option matching accepts exact code or bilingual labels", () => {
  assert.equal(matchQualitativeOption(options, " POS ")?.id, "positive");
  assert.equal(matchQualitativeOption(options, "positive")?.id, "positive");
  assert.equal(matchQualitativeOption(options, "إيجابي")?.id, "positive");
  assert.equal(matchQualitativeOption(options, "negative")?.id, "negative");
  assert.equal(matchQualitativeOption(options, "posit")?.id, undefined);
});

test("qualitative option targeting is strict to test and component", () => {
  assert.equal(optionAppliesToField(options[0], "T1", null), true);
  assert.equal(optionAppliesToField(options[0], "T2", null), false);
  assert.equal(optionAppliesToField(options[0], "T1", "C1"), false);
});

test("positive and negative polarity do not imply abnormality", () => {
  assert.deepEqual(qualitativeFlag(options[0]), {
    flag: "POSITIVE",
    isAbnormal: true,
    isCritical: false,
  });
  assert.deepEqual(qualitativeFlag(options[1]), {
    flag: "NEGATIVE",
    isAbnormal: false,
    isCritical: false,
  });

  assert.equal(validationHoldMatches(
    { condition: "ANY_ABNORMAL", resultSource: null },
    {
      source: "MANUAL",
      values: [{ flag: "NEGATIVE", isAbnormal: false, isCritical: false, deltaEvaluation: "NOT_CONFIGURED" }],
    },
  ), false);

  assert.equal(validationHoldMatches(
    { condition: "ANY_ABNORMAL", resultSource: null },
    {
      source: "MANUAL",
      values: [{ flag: "POSITIVE", isAbnormal: true, isCritical: false, deltaEvaluation: "NOT_CONFIGURED" }],
    },
  ), true);
});

test("autoverification normality gate uses explicit abnormality, not polarity", () => {
  const policy = {
    id: "P1",
    enabled: true,
    allowManual: true,
    allowAnalyzer: false,
    allowImport: false,
    requireNoCritical: true,
    requireDeltaWithinLimit: true,
    requireNoPendingReflex: true,
    requireNoBlockingHolds: true,
    requireAllFlagsNormal: true,
  };

  const negative = evaluateAutoverification({
    policy,
    source: "MANUAL",
    complete: true,
    values: [{ flag: "NEGATIVE", isAbnormal: false, isCritical: false, deltaEvaluation: "NOT_CONFIGURED" }],
    pendingReflexCount: 0,
    blockingHoldCount: 0,
  });
  assert.equal(negative.eligible, true);

  const positiveAbnormal = evaluateAutoverification({
    policy,
    source: "MANUAL",
    complete: true,
    values: [{ flag: "POSITIVE", isAbnormal: true, isCritical: false, deltaEvaluation: "NOT_CONFIGURED" }],
    pendingReflexCount: 0,
    blockingHoldCount: 0,
  });
  assert.equal(positiveAbnormal.eligible, false);
  assert.ok(positiveAbnormal.reasons.includes("NON_NORMAL_FLAG_PRESENT"));
});
