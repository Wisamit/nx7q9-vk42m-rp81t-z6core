import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { formatCalendarDisplay, formatInstantDateDisplay, formatInstantDisplay } from "../src/lib/system-date-display.ts";

const base = { dateFormat: "DD/MM/YYYY" as const, timeFormat: "24" as const,
  timeZone: "Asia/Dubai", showSeconds: false };

test("organization display uses configured calendar without altering a date-only value", () => {
  assert.equal(formatCalendarDisplay("2026-11-05", "DD/MM/YYYY"), "05/11/2026");
  assert.equal(formatCalendarDisplay("2026-11-05", "MM/DD/YYYY"), "11/05/2026");
  assert.equal(formatCalendarDisplay("2026-11-05", "YYYY-MM-DD"), "2026-11-05");
  assert.equal(formatCalendarDisplay("2026-11-05", "DD MMM YYYY"), "05 Nov 2026");
  assert.equal(formatCalendarDisplay("2026-02-30", "DD/MM/YYYY"), "—");
});

test("instant display converts once to the organization timezone with 12/24-hour options", () => {
  const instant = "2026-11-05T22:35:42.000Z";
  assert.equal(formatInstantDisplay(instant, base), "06/11/2026 02:35");
  assert.equal(formatInstantDateDisplay(instant, base), "06/11/2026");
  assert.equal(formatInstantDisplay(instant, {...base, timeFormat: "12", showSeconds: true}),
    "06/11/2026 02:35:42 AM");
  assert.equal(formatInstantDisplay(instant, {...base, timeZone: "UTC"}), "05/11/2026 22:35");
  assert.equal(formatInstantDisplay("2026-11-05T22:35", base), "—",
    "Bare datetime-local must never silently be interpreted in the server timezone");
  assert.equal(formatInstantDisplay("invalid", base), "—");
  assert.equal(formatInstantDisplay(instant, {...base, timeZone: "Invalid/Zone"}), "—");
});

test("UI batch 03: ten additional routes use preference-aware date display, not raw UTC text", () => {
  const pages = [
    "src/app/reports/page.tsx",
    "src/app/analytics/page.tsx",
    "src/app/orders/delivery-queue/page.tsx",
    "src/app/critical-results/page.tsx",
    "src/app/billing/accounts/statements/[id]/page.tsx",
    "src/app/integrations/page.tsx",
    "src/app/resilience/page.tsx",
    "src/app/home-collections/page.tsx",
    "src/app/home-collections/[id]/page.tsx",
    "src/app/dashboard/page.tsx",
  ];
  assert.equal(new Set(pages).size, 10);
  for (const page of pages) {
    const src = readFileSync(page, "utf8");
    assert.ok(src.includes('import { SystemDateText } from "@/components/system-date-text";'), page);
    assert.ok(src.includes("<SystemDateText"), page);
  }
  for (const page of pages.slice(0,2)) {
    assert.ok(readFileSync(page,"utf8").includes("<SystemDateField"),
      page + ": date range filters must honor organization format and submit canonical ISO");
  }
  for (const page of pages.slice(7,9)) {
    const src = readFileSync(page, "utf8");
    assert.ok(src.includes("timeZone={visit.branch.timezone}"),
      page + ": home collection appointment timestamps retain the performing branch timezone");
  }
  const critical = readFileSync(pages[3], "utf8");
  assert.ok(critical.includes('tr(locale, "Next", "التالي") + ": "}<SystemDateText'));
  assert.doesNotMatch(critical, /\+\s*<SystemDateText/,
    "JSX must not be coerced into text when rendering a critical escalation deadline");

  const layout = readFileSync("src/app/layout.tsx", "utf8");
  const client = readFileSync("src/components/system-date-text.tsx", "utf8");
  for (const attribute of ["data-date-format", "data-timezone", "data-time-format", "data-show-seconds"]) {
    assert.ok(layout.includes(attribute), attribute);
  }
  assert.ok(client.includes("useSyncExternalStore("));
  assert.ok(client.includes('dateTime={kind === "calendar-record" ? (calendarRecord || "") : value}'),
    "actual instants preserve their original ISO, but UTC-midnight SQL calendar dates expose the canonical day");
  assert.ok(client.includes('title={kind === "calendar-record" ? (calendarRecord || value)'),
    "calendar-only dates use the same stable day for hover context, while instants retain the timezone");
  assert.ok(client.includes("timeZone: zone"));
});
