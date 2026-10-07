import test from "node:test";
import assert from "node:assert/strict";
import {
  effectiveReportLocale,
  localizedReportText,
  reportShowsArabic,
  reportShowsEnglish,
  secondaryReportText,
} from "../src/lib/report-language.ts";

test("English and Arabic report modes override viewer UI locale", () => {
  assert.equal(effectiveReportLocale("ENGLISH", "ar"), "en");
  assert.equal(effectiveReportLocale("ARABIC", "en"), "ar");
});

test("bilingual report mode follows viewer locale for the primary label", () => {
  assert.equal(effectiveReportLocale("BILINGUAL", "ar"), "ar");
  assert.equal(effectiveReportLocale("BILINGUAL", "en"), "en");
});

test("single-language report modes suppress the other language", () => {
  assert.equal(reportShowsEnglish("ENGLISH"), true);
  assert.equal(reportShowsArabic("ENGLISH"), false);
  assert.equal(reportShowsEnglish("ARABIC"), false);
  assert.equal(reportShowsArabic("ARABIC"), true);
  assert.equal(reportShowsEnglish("BILINGUAL"), true);
  assert.equal(reportShowsArabic("BILINGUAL"), true);
});

test("bilingual report returns the opposite language as secondary text", () => {
  const value = { en: "Hemoglobin", ar: "الهيموغلوبين" };
  assert.equal(localizedReportText("BILINGUAL", "en", value), "Hemoglobin");
  assert.equal(secondaryReportText("BILINGUAL", "en", value), "الهيموغلوبين");
  assert.equal(localizedReportText("BILINGUAL", "ar", value), "الهيموغلوبين");
  assert.equal(secondaryReportText("BILINGUAL", "ar", value), "Hemoglobin");
  assert.equal(secondaryReportText("ENGLISH", "ar", value), null);
});
