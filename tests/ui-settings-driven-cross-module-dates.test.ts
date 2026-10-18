import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  formatCalendarDisplay,
  formatInstantDateDisplay,
  formatInstantDisplay,
  parseUtcCalendarRecord,
} from "../src/lib/system-date-display.ts";

const read = (name: string) => readFileSync("src/components/" + name + ".tsx", "utf8");

test("SQL UTC-midnight calendar record remains the SAME intended day in all organization timezones", () => {
  const stored = "2026-01-01T00:00:00.000Z";
  assert.equal(parseUtcCalendarRecord(stored), "2026-01-01");
  assert.equal(formatCalendarDisplay(parseUtcCalendarRecord(stored)!, "DD/MM/YYYY"), "01/01/2026");
  assert.equal(formatCalendarDisplay(parseUtcCalendarRecord(stored)!, "MM/DD/YYYY"), "01/01/2026");
  assert.equal(formatCalendarDisplay(parseUtcCalendarRecord("2026-11-05T00:00:00.000Z")!, "DD/MM/YYYY"), "05/11/2026");
  assert.equal(formatCalendarDisplay(parseUtcCalendarRecord("2026-11-05T00:00:00.000Z")!, "MM/DD/YYYY"), "11/05/2026");
  assert.equal(formatCalendarDisplay(parseUtcCalendarRecord("2026-11-05T00:00:00Z")!, "YYYY-MM-DD"), "2026-11-05");
});

test("calendar record parser rejects arbitrary instants, offsets and invalid date values", () => {
  for (const value of [
    "2026-01-01T12:00:00.000Z", "2026-01-01T00:00:00+04:00",
    "2026-01-01T00:00:00.123Z", "2026-02-30T00:00:00.000Z",
    "2026-01-01", "2026-11-05T00:00:00.000+00:00", "not-a-date",
  ]) {
    assert.equal(parseUtcCalendarRecord(value), null, value);
  }
});

test("actual UTC instants move to correct local time/day under two organization timezone settings", () => {
  const instant = "2026-01-01T23:30:00.000Z";
  const shared = { dateFormat: "DD/MM/YYYY" as const, timeFormat: "24" as const, showSeconds: false };
  assert.equal(formatInstantDisplay(instant, { ...shared, timeZone: "Asia/Dubai" }), "02/01/2026 03:30");
  assert.equal(formatInstantDisplay(instant, { ...shared, timeZone: "America/New_York" }), "01/01/2026 18:30");
  assert.equal(formatInstantDateDisplay(instant, { ...shared, timeZone: "Asia/Dubai" }), "02/01/2026");
  assert.equal(formatInstantDateDisplay(instant, {
    dateFormat: "MM/DD/YYYY", timeFormat: "24", showSeconds: false,
    timeZone: "America/New_York",
  }), "01/01/2026");
  assert.equal(formatInstantDisplay("2026-01-01T23:30:00", { ...shared, timeZone: "Asia/Dubai" }), "—",
    "naive timestamps must never be guessed into the configured zone");
});

test("date display component uses reactive root organization settings, accessible original value and distinct calendar semantics", () => {
  const component = read("system-date-text");
  assert.match(component, /useSyncExternalStore\(subscribeRootDatePreferences/);
  assert.match(component, /kind === "calendar-record"/);
  assert.match(component, /parseUtcCalendarRecord\(value\)/);
  assert.match(component, /formatCalendarDisplay\(calendarRecord, dateFormat\)/);
  assert.match(component, /kind === "instant-date"/);
  assert.match(component, /dateTime=\{kind === "calendar-record"/);
  assert.match(component, /timeZone \|\| settings\[1\]/);
});

test("operational quality and EQA screens honor organization clock and calendar without changing inputs", () => {
  const qms = read("quality-management-console");
  const eqa = read("eqa-workspace");
  assert.match(qms, /SystemDateText value=\{item\.dueDate\} kind="calendar-record"/);
  assert.match(qms, /SystemDateText value=\{item\.assignedAt\} kind="instant-date"/);
  assert.match(qms, /SystemDateText value=\{item\.authorizedAt\} kind="instant-date"/);
  assert.match(qms, /SystemDateText value=\{latest\.periodEnd\} kind="calendar-record"/);
  assert.match(qms, /SystemDateText value=\{audit\.scheduledAt\} kind="calendar-record"/);
  assert.doesNotMatch(qms, /(?:dueDate|scheduledAt|reviewDueAt|periodEnd|assignedAt|assessedAt|authorizedAt)\??\.slice\(0,10\)/);
  assert.match(eqa, /SystemDateText value=\{r\.dueAt\}/);
  assert.doesNotMatch(eqa, /new Date\(value\)\.toLocaleString/);
  assert.match(eqa, /SystemDateTimeField name="dueAt"/);
});

test("finance, digital service, inventory and patient reports no longer strip UTC offset before display", () => {
  const billing = read("client-account-manager");
  const digital = read("digital-services-console");
  const lots = read("inventory-lot-safety-manager");
  const responses = read("inventory-lot-branch-response");
  const trends = read("patient-result-trends");
  const cumulative = read("report-cumulative-comparison");
  assert.match(billing, /SystemDateText value=\{invoice\.issuedAt\} kind="instant-date"/);
  assert.match(billing, /SystemDateText value=\{statement\.generatedAt\}/);
  assert.match(billing, /SystemDateText value=\{statement\.periodStart\} kind="calendar"/);
  assert.match(billing, /SystemDateText value=\{statement\.periodEnd\} kind="calendar"/);
  assert.match(digital, /SystemDateText value=\{item\.effectiveFrom\} kind="calendar-record"/);
  assert.match(digital, /SystemDateText value=\{item\.scheduledStart\}/);
  assert.match(lots, /SystemDateText value=\{lot\.expiryDate\} kind="calendar"/);
  assert.match(lots, /SystemDateText value=\{e\.at\}/);
  assert.match(responses, /SystemDateText value=\{r\.at\}/);
  assert.match(trends, /SystemDateText value=\{point\.observedAt\}/);
  assert.match(cumulative, /SystemDateText value=\{row\.previous\.issuedAt\}/);
  for (const source of [billing,digital,lots,responses,trends,cumulative]) {
    assert.doesNotMatch(source, /\.replace\("T",\s*" "\)\.slice\(0,\s*(?:16|19)\)/);
  }
});

test("canonical route/UI acceptance evidence still exists; static date refactor does not imply browser signoff", () => {
  const manifest = JSON.parse(readFileSync("docs/UI_ROUTE_MANIFEST.json", "utf8"));
  assert.equal(manifest.expectedRouteCount, 81);
  const docs = readFileSync("docs/UI_SETTINGS_DRIVEN_DATE_DISPLAY_CLOSURE.md", "utf8");
  assert.match(docs, /NOT_EXECUTED/);
  assert.match(docs, /NO_GO/);
  assert.match(docs, /No clinical.*data migration/i);
});
