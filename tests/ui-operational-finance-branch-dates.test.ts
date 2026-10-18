import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  parseUtcCalendarRecord, formatCalendarDisplay, formatInstantDisplay,
} from "../src/lib/system-date-display.ts";

const page = (name: string) => readFileSync("src/app/" + name + "/page.tsx", "utf8");

test("analyzer Bridge staging, inbound and outbound worklist dates retain their specific analyzer branch", () => {
  const src = page("analyzers");
  assert.match(src, /import \{ SystemDateText \} from "@\/components\/system-date-text"/);
  assert.match(src, /analyzer: \{ include: \{ branch: \{ select: \{ timezone: true \} \} \} \}/);
  assert.match(src, /analyzer: \{ select: \{ code: true, name: true, branch: \{ select: \{ timezone: true \} \} \} \}/);
  assert.match(src, /SystemDateText value=\{item\.receivedAt\.toISOString\(\)\} timeZone=\{item\.analyzer\.branch\.timezone\}/);
  assert.match(src, /SystemDateText value=\{item\.nextAttemptAt\.toISOString\(\)\} timeZone=\{item\.analyzer\.branch\.timezone\}/);
  assert.match(src, /SystemDateText value=\{item\.createdAt\.toISOString\(\)\} timeZone=\{item\.analyzer\.branch\.timezone\}/);
  assert.doesNotMatch(src, /\.toISOString\(\)\.replace\("T"," "\)\.slice\(0,19\)/);
  assert.match(src, /analyzers\.replay/);
  assert.match(src, /AnalyzerClinicalImportButton/);
});

test("analyzer mapping start stays a calendar date, but effective end and decision events expose exact instants", () => {
  const src = page("analyzers");
  assert.match(src, /mapping\.effectiveFrom\.toISOString\(\)\} kind="calendar-record"/);
  assert.match(src, /mapping\.effectiveTo\.toISOString\(\)\} timeZone=\{item\.branch\.timezone\}/);
  assert.match(src, /mapping\.approvedAt\.toISOString\(\)\} timeZone=\{item\.branch\.timezone\}/);
  assert.match(src, /mapping\.retiredAt\.toISOString\(\)\} timeZone=\{item\.branch\.timezone\}/);
  assert.match(src, /mapping\.retirementReason/);
  assert.match(src, /approvalStatus === "APPROVED"/);
  const midnight = "2026-11-05T00:00:00.000Z";
  assert.equal(formatCalendarDisplay(parseUtcCalendarRecord(midnight)!, "DD/MM/YYYY"), "05/11/2026");
  assert.equal(formatCalendarDisplay(parseUtcCalendarRecord(midnight)!, "MM/DD/YYYY"), "11/05/2026");
  const end = "2026-11-05T19:30:00.000Z";
  const options = {dateFormat:"DD/MM/YYYY" as const,timeFormat:"24" as const,showSeconds:false};
  assert.equal(formatInstantDisplay(end, {...options,timeZone:"Asia/Dubai"}), "05/11/2026 23:30");
  assert.equal(formatInstantDisplay(end, {...options,timeZone:"America/New_York"}), "05/11/2026 14:30");
  assert.equal(parseUtcCalendarRecord(end), null, "arbitrary cutoff is not a calendar-only record");
});

test("QC, equipment and procurement use branch-local event times and immutable maintenance calendar due dates", () => {
  const qc = page("qc"), equipment = page("equipment"), procurement = page("inventory/procurement");
  assert.match(qc, /branch: \{ select: \{ timezone: true \} \}/);
  assert.match(qc, /SystemDateText value=\{run\.runAt\.toISOString\(\)\} timeZone=\{run\.branch\.timezone\}/);
  assert.match(equipment, /SystemDateText value=\{item\.maintenancePlans\[0\]\.nextDueAt\.toISOString\(\)\} kind="calendar-record"/);
  assert.match(equipment, /SystemDateText value=\{item\.calibrationEvents\[0\]\.performedAt\.toISOString\(\)\} kind="instant-date" timeZone=\{item\.branch\.timezone\}/);
  assert.match(procurement, /SystemDateText value=\{request\.requestedAt\.toISOString\(\)\} kind="instant-date" timeZone=\{request\.branch\.timezone\}/);
  for(const src of [qc,equipment,procurement]) {
    assert.doesNotMatch(src, /\.toISOString\(\)\.replace\("T"," "\)\.slice\(0,19\)/);
  }
  assert.match(qc, /qc\.view/);
  assert.match(equipment, /equipment\.view/);
  assert.match(procurement, /procurement\.view/);
});

test("inventory FEFO keeps exact date-only lot expiry and branch-local goods receipt instants", () => {
  const src = page("inventory");
  assert.match(src, /stock\.lot\.expiryDate\.toISOString\(\)\} kind="calendar-record"/);
  assert.match(src, /receipt\.receivedAt\.toISOString\(\)\} timeZone=\{receipt\.branch\.timezone\}/);
  assert.match(src, /aExpiry - bExpiry/, "original FEFO ordering stays untouched");
  assert.match(src, /lotStocks/);
  assert.match(src, /branchId: \{ in: branchIds \}/);
  assert.doesNotMatch(src, /receivedAt\.toISOString\(\)\.replace/);
});

test("financial reports use one declared report timezone consistent with their period filters", () => {
  const src = page("billing/reports");
  assert.match(src, /const reportTimeZone = branchId/);
  assert.match(src, /resolveReportPeriod\(params, reportTimeZone\)/);
  assert.match(src, /localDateTimeToUtc\(from \+ "T00:00:00", timeZone\)/);
  for (const at of ["item.issuedAt","item.payment.receivedAt","item.processedAt"]) {
    assert.ok(src.includes(`SystemDateText value={${at}.toISOString()} timeZone={reportTimeZone}`), at);
  }
  assert.match(src, /aggregateFinancialReport/);
  assert.match(src, /item\.subtotal\.toFixed\(4\)/);
  assert.match(src, /item\.taxTotal\.toFixed\(4\)/);
  assert.match(src, /item\.balanceAmount\.toFixed\(4\)/);
  assert.match(src, /Amounts are never combined across currencies/);
  assert.doesNotMatch(src, /(?:issuedAt|receivedAt|processedAt)\.toISOString\(\)\.replace/);
  assert.doesNotMatch(src, /\.replace\("T", " "\)\.slice\(0, 19\)/);
});

test("same instant displays different calendar days between Asia/Dubai and America/New_York", () => {
  const at="2026-10-18T22:30:00.000Z";
  const base={ dateFormat:"DD/MM/YYYY" as const,timeFormat:"24" as const,showSeconds:false };
  assert.equal(formatInstantDisplay(at,{...base,timeZone:"Asia/Dubai"}),"19/10/2026 02:30");
  assert.equal(formatInstantDisplay(at,{...base,timeZone:"America/New_York"}),"18/10/2026 18:30");
});

test("no server mutation or production UAT acceptance is implied by display-only updates", () => {
  const docs = readFileSync("docs/UI_OPERATIONAL_FINANCE_BRANCH_DATE_CLOSURE.md","utf8");
  assert.match(docs,/NO_GO/);
  assert.match(docs,/NOT_EXECUTED/);
  assert.match(docs,/No schema migration/);
  assert.match(docs,/Issue #265 OPEN/);
});
