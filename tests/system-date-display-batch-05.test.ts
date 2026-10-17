import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { formatCalendarDisplay, formatInstantDisplay } from "../src/lib/system-date-display.ts";

const routes: Record<string, { calendar?: boolean; branch?: boolean }> = {
  "src/app/patients/page.tsx": { calendar: true },
  "src/app/patients/[id]/page.tsx": { calendar: true },
  "src/app/orders/page.tsx": { branch: true },
  "src/app/billing/page.tsx": { branch: true },
  "src/app/microbiology/[id]/page.tsx": { calendar: true, branch: true },
  "src/app/notifications/page.tsx": { branch: true },
  "src/app/search/page.tsx": {},
  "src/app/inventory/operations/page.tsx": { branch: true },
  "src/app/inventory/lot-impact/[lotId]/page.tsx": { branch: true },
  "src/app/inventory/recall-quality/page.tsx": { branch: true },
};

test("UI date batch 05: ten distinct operational routes display configured dates", () => {
  assert.equal(Object.keys(routes).length, 10);
  for (const [path, spec] of Object.entries(routes)) {
    const source = readFileSync(path, "utf8");
    assert.ok(source.includes('import { SystemDateText } from "@/components/system-date-text";'), path);
    assert.ok(source.includes("<SystemDateText"), path);
    if (spec.calendar) assert.ok(source.includes('kind="calendar"'), path + " must not timezone-shift patient birth date");
    if (spec.branch) assert.ok(source.includes("timeZone={"), path + " branch timestamps must not display raw UTC");
  }
});

test("patient identity values and billing event timestamps remain source data, not rewritten", () => {
  const patient = readFileSync("src/app/patients/[id]/page.tsx", "utf8");
  assert.ok(patient.includes("dateOfBirth: patient.dateOfBirth?.toISOString().slice(0,10) || null"));
  assert.ok(patient.includes("dateOfBirth: candidate.dateOfBirth?.toISOString().slice(0,10) || null"));
  assert.ok(patient.includes("updatedAt: patient.updatedAt.toISOString()"));
  const billing = readFileSync("src/app/billing/page.tsx", "utf8");
  assert.ok(billing.includes("receivedAt: payment.receivedAt.toISOString()"));
  assert.ok(billing.includes("requestedAt: item.requestedAt.toISOString()"));
  assert.ok(billing.includes("expiresAt: item.expiresAt.toISOString()"));
  const lot = readFileSync("src/app/inventory/lot-impact/[lotId]/page.tsx", "utf8");
  assert.ok(lot.includes("at:r.createdAt.toISOString()"));
  const ops = readFileSync("src/app/inventory/operations/page.tsx", "utf8");
  assert.ok(ops.includes("at:event.createdAt.toISOString()"));
  assert.ok(ops.includes("expiryDate:lot.expiryDate?.toISOString().slice(0,10)||null"));
});

test("configured date displays distinguish clinical calendar date from timezone-aware instants", () => {
  assert.equal(formatCalendarDisplay("2026-11-05", "DD/MM/YYYY"), "05/11/2026");
  const timestamp = "2026-11-05T22:35:00.000Z";
  const dubai = {dateFormat:"DD/MM/YYYY" as const,timeZone:"Asia/Dubai",timeFormat:"24" as const,showSeconds:false};
  assert.equal(formatInstantDisplay(timestamp, dubai), "06/11/2026 02:35");
  assert.equal(formatInstantDisplay(timestamp,{...dubai,timeZone:"UTC"}), "05/11/2026 22:35");
  assert.equal(formatInstantDisplay("2026-11-05T22:35",dubai), "—",
    "No unqualified instant date/time should be interpreted in browser/server timezone");
});

test("branch-specific clinical and financial events carry explicit zone to the display component", () => {
  const cases: Array<[string, string]> = [
    ["src/app/orders/page.tsx", "order.orderingBranch.timezone"],
    ["src/app/billing/page.tsx", "invoice.branch.timezone"],
    ["src/app/microbiology/[id]/page.tsx", "microbiologyCase.performingBranch.timezone"],
    ["src/app/inventory/operations/page.tsx", "movement.branch.timezone"],
    ["src/app/inventory/lot-impact/[lotId]/page.tsx", "x.run.branch.timezone"],
  ];
  for(const [file, prop] of cases) assert.ok(readFileSync(file,"utf8").includes("timeZone={"+prop+"}"),file+" explicit timezone");
});
