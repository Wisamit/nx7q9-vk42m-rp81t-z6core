import test from "node:test";
import assert from "node:assert/strict";
import {
  localDateTimeToUtc,
  nextQuestionVersion,
  normalizeOrderQuestionOptions,
  orderQuestionIsEffective,
} from "../src/lib/order-questions.ts";

test("legacy single-choice strings normalize into stable coded options", () => {
  assert.deepEqual(
    normalizeOrderQuestionOptions(["Fasting", "Non-fasting"]),
    [
      { code: "FASTING", valueEn: "Fasting", valueAr: null },
      { code: "NON_FASTING", valueEn: "Non-fasting", valueAr: null },
    ],
  );
});

test("structured bilingual choice options preserve code and labels", () => {
  assert.deepEqual(
    normalizeOrderQuestionOptions([
      { code: "FASTING", valueEn: "Fasting", valueAr: "صائم" },
      { code: "NON_FASTING", valueEn: "Non-fasting", valueAr: "غير صائم" },
    ]),
    [
      { code: "FASTING", valueEn: "Fasting", valueAr: "صائم" },
      { code: "NON_FASTING", valueEn: "Non-fasting", valueAr: "غير صائم" },
    ],
  );
});

test("duplicate normalized choice codes fail closed by keeping one deterministic option", () => {
  assert.deepEqual(
    normalizeOrderQuestionOptions([
      { code: "POSITIVE", valueEn: "Positive", valueAr: "إيجابي" },
      { code: "positive", valueEn: "Reactive", valueAr: "تفاعلي" },
    ]),
    [{ code: "POSITIVE", valueEn: "Positive", valueAr: "إيجابي" }],
  );
});

test("question revision increments version and requires later effective start", () => {
  const existing = [{ version: 1, effectiveFrom: new Date("2026-10-01T00:00:00.000Z") }];
  assert.deepEqual(
    nextQuestionVersion(existing, new Date("2026-10-08T00:00:00.000Z")),
    { version: 2, supersedesVersion: 1 },
  );
  assert.throws(
    () => nextQuestionVersion(existing, new Date("2026-10-01T00:00:00.000Z")),
    /QUESTION_REVISION_MUST_START_AFTER_PREVIOUS_VERSION/,
  );
});

test("effective question selection respects status and effective dates", () => {
  const at = new Date("2026-10-07T12:00:00.000Z");
  assert.equal(orderQuestionIsEffective({
    status: "ACTIVE",
    effectiveFrom: new Date("2026-10-01T00:00:00.000Z"),
    effectiveTo: new Date("2026-10-31T23:59:59.999Z"),
  }, at), true);
  assert.equal(orderQuestionIsEffective({
    status: "INACTIVE",
    effectiveFrom: new Date("2026-10-01T00:00:00.000Z"),
    effectiveTo: null,
  }, at), false);
  assert.equal(orderQuestionIsEffective({
    status: "ACTIVE",
    effectiveFrom: new Date("2026-10-08T00:00:00.000Z"),
    effectiveTo: null,
  }, at), false);
});

test("branch-local datetime converts to UTC while preserving intended wall-clock time", () => {
  const utc = localDateTimeToUtc("2026-10-07T14:30", "Asia/Dubai");
  assert.equal(utc?.toISOString(), "2026-10-07T10:30:00.000Z");
});

test("invalid or impossible local datetime is rejected", () => {
  assert.equal(localDateTimeToUtc("2026-02-30T14:30", "Asia/Dubai"), null);
  assert.equal(localDateTimeToUtc("not-a-date", "Asia/Dubai"), null);
});
