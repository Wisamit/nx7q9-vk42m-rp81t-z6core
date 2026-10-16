import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { composeSystemLocalDateTime, parseSystemLocalDateTime } from "../src/lib/system-date-time.ts";
import { formatSystemDate, parseSystemDateInput } from "../src/lib/system-date.ts";

const read = (path: string) => readFileSync(path, "utf8");

test("local wall clock retains exact date and time with no UTC or browser timezone conversion", () => {
  assert.deepEqual(parseSystemLocalDateTime("2026-11-05T09:35"), { date: "2026-11-05", time: "09:35" });
  assert.equal(composeSystemLocalDateTime("2026-11-05", "09:35"), "2026-11-05T09:35");
  assert.equal(parseSystemDateInput("05/11/2026", "DD/MM/YYYY"), "2026-11-05");
  assert.equal(formatSystemDate("2026-11-05", "DD/MM/YYYY"), "05/11/2026");
  for (const invalid of ["2026-02-30T09:35", "2026-11-05T25:00", "2026-11-05T09:70",
    "05/11/2026T09:35", "2026-11-05 09:35", "2026-11-05T09:35Z", "2026-11-05T09:35:12"]) {
    assert.deepEqual(parseSystemLocalDateTime(invalid), { date: "", time: "" }, invalid);
  }
  assert.equal(composeSystemLocalDateTime("2026-02-30", "09:35"), "");
  assert.equal(composeSystemLocalDateTime("2026-11-05", "25:05"), "");
  assert.equal(composeSystemLocalDateTime("2026-11-05", ""), "");
});

test("UI batch 02: ten targeted screens no longer depend on browser-specific date display", () => {
  const components: Record<string, string[]> = {
    "clinical-catalog-manager": ["effectiveFrom", "effectiveTo"],
    "order-question-manager": ["effectiveFrom", "effectiveTo"],
    "advanced-clinical-rules-manager": ["effectiveFrom", "effectiveTo"],
    "critical-escalation-manager": ["effectiveFrom", "effectiveTo"],
    "result-validation-policy-manager": ["effectiveFrom", "effectiveTo"],
    "qualitative-result-options-manager": ["effectiveFrom", "effectiveTo"],
    "analyzer-manager": ["effectiveFrom", "effectiveTo"],
    "tax-rule-manager": ["effectiveFrom"],
  };
  for (const [filename, fieldNames] of Object.entries(components)) {
    const source = read("src/components/" + filename + ".tsx");
    assert.ok(source.includes("SystemDateField"), filename);
    assert.doesNotMatch(source, /<input\b[^>]*type="date"/, filename);
    for (const field of fieldNames) assert.ok(source.includes('name="' + field + '"'), filename + ":" + field);
  }

  const billingReport = read("src/app/billing/reports/page.tsx");
  const aging = read("src/app/billing/accounts/aging/page.tsx");
  for (const source of [billingReport, aging]) {
    assert.ok(source.includes("SystemDateField"));
    assert.doesNotMatch(source, /<input\b[^>]*type="date"/);
  }
  for (const path of ["src/components/eqa-workspace.tsx", "src/components/portal-booking-form.tsx",
    "src/components/inventory-manager.tsx"]) {
    const source = read(path);
    assert.ok(source.includes("SystemDateTimeField"), path);
    assert.doesNotMatch(source, /<input\b[^>]*type="datetime-local"/, path);
  }

  const field = read("src/components/system-date-time-field.tsx");
  assert.ok(field.includes('type="hidden" name={name} value={value}'));
  assert.ok(field.includes('type="time"'));
  assert.ok(field.includes('required={required}'));
  assert.ok(field.includes("onIsoChange={setDateIso}"));
  assert.doesNotMatch(field, /new Date|toISOString|Date\.parse/);
  assert.doesNotMatch(read("src/components/result-validation-policy-manager.tsx"),
    /new Date\(\)\.toISOString\(\)\.slice\(0,10\)/,
    "Do not choose a clinical effective date in the server's UTC timezone");
});
