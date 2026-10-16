import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  dateInputExample, formatSystemDate, normalizeSystemDateFormat, parseSystemDateInput,
} from "../src/lib/system-date.ts";

test("organization date choices round-trip without ambiguous US/GB interpretation", () => {
  const iso = "2026-11-05";
  for (const [format, display] of [
    ["DD/MM/YYYY", "05/11/2026"],
    ["MM/DD/YYYY", "11/05/2026"],
    ["YYYY-MM-DD", "2026-11-05"],
    ["DD MMM YYYY", "05 Nov 2026"],
  ] as const) {
    assert.equal(formatSystemDate(iso, format), display);
    assert.equal(parseSystemDateInput(display, format), iso);
    assert.ok(dateInputExample(format));
  }
  assert.equal(parseSystemDateInput("05/11/2026", "DD/MM/YYYY"), "2026-11-05");
  assert.equal(parseSystemDateInput("05/11/2026", "MM/DD/YYYY"), "2026-05-11");
  assert.equal(normalizeSystemDateFormat("other"), "DD/MM/YYYY");
});

test("reject invalid, incomplete and locale-ambiguous calendar dates, including leap years", () => {
  const rejects = ["31/02/2026", "29/02/2025", "32/01/2026", "00/10/2026", "05/13/2026", "5/11/2026", "05/11/26"];
  for (const value of rejects) assert.equal(parseSystemDateInput(value, "DD/MM/YYYY"), null, value);
  assert.equal(parseSystemDateInput("29/02/2024", "DD/MM/YYYY"), "2024-02-29");
  assert.equal(parseSystemDateInput("٢٩/٠٢/٢٠٢٤", "DD/MM/YYYY"), "2024-02-29");
  assert.equal(parseSystemDateInput("۲۹/۰۲/۲۰۲۴", "DD/MM/YYYY"), "2024-02-29");
  assert.equal(parseSystemDateInput("2026-02-30", "YYYY-MM-DD"), null);
  assert.equal(parseSystemDateInput("05 Foo 2026", "DD MMM YYYY"), null);
  assert.equal(formatSystemDate("not-a-date", "DD/MM/YYYY"), "");
});

test("batch 01: ten explicit screens adopt configured date editors without changing API payload keys", () => {
  const cases = {
    "patient-create-form": ["dateOfBirth"],
    "patient-edit-form": ["dateOfBirth"],
    "order-create-form": ["question_"],
    "client-account-manager": ["periodStart", "periodEnd"],
    "pricing-manager": ["effectiveFrom", "effectiveTo"],
    "qc-manager": ["receivedAt", "openedAt", "expiryDate", "effectiveFrom", "effectiveTo"],
    "quality-management-console": ["dueDate", "reviewDueAt", "assignedAt", "assessedAt", "scheduledAt", "periodStart", "periodEnd"],
    "digital-services-console": ["effectiveFrom", "effectiveTo"],
    "procurement-manager": ["expectedAt"],
    "equipment-manager": ["installationDate", "warrantyUntil", "dueAt", "nextDueAt", "expiresAt"],
  };
  assert.equal(Object.keys(cases).length, 10);
  for (const [component, names] of Object.entries(cases)) {
    const source = readFileSync("src/components/" + component + ".tsx", "utf8");
    assert.ok(source.includes('import { SystemDateField } from "@/components/system-date-field";'), component);
    assert.ok(source.includes("<SystemDateField"), component);
    assert.doesNotMatch(source, /<input\b[^>]*\btype="date"/, component);
    for (const name of names) assert.ok(source.includes(name), component + ":" + name);
  }
  const root = readFileSync("src/app/layout.tsx", "utf8");
  const field = readFileSync("src/components/system-date-field.tsx", "utf8");
  assert.ok(root.includes('data-date-format={settings?.dateFormat || "DD/MM/YYYY"}'));
  assert.ok(field.includes("document.documentElement.dataset.dateFormat"));
  assert.ok(field.includes('type="hidden" name={name} value={validIso}'));
  assert.ok(field.includes('type="date"'));
  assert.ok(field.includes('inputRef.current.setCustomValidity('));
  assert.ok(field.includes('calendar.showPicker()'));
});
