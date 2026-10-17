import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { formatCalendarDisplay, formatInstantDisplay } from "../src/lib/system-date-display.ts";

const read = (path: string) => readFileSync(path, "utf8");
const paths = [
  "src/app/patients/[id]/history/page.tsx",
  "src/app/orders/[id]/page.tsx",
  "src/app/specimens/page.tsx",
  "src/app/transfers/page.tsx",
  "src/app/worklists/page.tsx",
  "src/app/worklists/[orderItemId]/page.tsx",
  "src/app/orders/[id]/clinical-handover/page.tsx",
  "src/app/inventory/transfers/page.tsx",
  "src/app/reports/[orderId]/page.tsx",
  "src/app/reports/[orderId]/interpretation/page.tsx",
];

test("batch 04: ten distinct clinical/operational routes retain underlying data and wire locale date display", () => {
  assert.equal(new Set(paths).size, 10);
  for (const file of paths) assert.ok(read(file).length > 30, file);
  for (const file of [paths[0], paths[1], paths[2], paths[4], paths[5], paths[8]]) {
    const text = read(file);
    assert.ok(text.includes('import { SystemDateText } from "@/components/system-date-text";'), file);
    assert.ok(text.includes("<SystemDateText"), file);
  }
  const managers = [
    "src/components/transfer-manager.tsx",
    "src/components/order-clinical-handover-manager.tsx",
    "src/components/report-interpretation-manager.tsx",
    "src/components/result-workflow-actions.tsx",
  ];
  for (const file of managers) {
    const text = read(file);
    assert.ok(text.includes('import { SystemDateText } from "@/components/system-date-text";'), file);
    assert.ok(text.includes("<SystemDateText"), file);
  }
  assert.ok(read(paths[3]).includes("<TransferManager"));
  assert.ok(read(paths[6]).includes("<OrderClinicalHandoverManager"));
  assert.ok(read(paths[7]).includes("<InventoryTransferManager"));
  assert.ok(read(paths[9]).includes("<ReportInterpretationManager"));
});

test("clinical event date displays honor performing/order/custody branch timezone", () => {
  const specimens = read(paths[2]);
  const worklist = read(paths[4]);
  const result = read(paths[5]);
  const workflow = read("src/components/result-workflow-actions.tsx");
  assert.ok(specimens.includes("timeZone={specimen.receptionAssessments[0].branch.timezone}"));
  assert.ok(specimens.includes("timeZone={event.branch?.timezone || specimen.order.orderingBranch.timezone}"));
  assert.ok(worklist.includes("timeZone={item.order.orderingBranch.timezone}"));
  assert.doesNotMatch(worklist, /const formatTatDueAt =/);
  assert.ok(result.includes("performingBranchTimezone={latestResult.performingBranch.timezone}"));
  assert.ok(result.includes("timeZone={latestResult.performingBranch.timezone}"));
  assert.ok(workflow.includes("performingBranchTimezone: string;"));
  assert.ok(workflow.includes("timeZone={performingBranchTimezone}"));
  assert.equal(formatInstantDisplay("2026-11-05T22:35:00Z", {
    dateFormat: "DD/MM/YYYY", timeFormat: "24", timeZone: "Asia/Dubai", showSeconds: false,
  }), "06/11/2026 02:35");
  assert.equal(formatCalendarDisplay("2026-11-05", "DD/MM/YYYY"), "05/11/2026");
});

test("historical released report stamp remains untouched; only staff audit panels reformat", () => {
  const page = read(paths[8]);
  assert.ok(page.includes('latest.issuedAt.toISOString().replace("T"," ").slice(0,19)'),
    "Do not retroactively restyle the versioned/released report body or PDF metadata");
  assert.ok(page.includes('value={version.issuedAt.toISOString()} timeZone={version.branch.timezone}'));
  assert.ok(page.includes('value={event.occurredAt.toISOString()}'));
  const inventory = read("src/components/inventory-transfer-manager.tsx");
  assert.ok(inventory.includes("formatCalendarDisplay(stock.expiryDate, dateFormat)"));
  assert.ok(inventory.includes("normalizeSystemDateFormat(useSyncExternalStore("));
  const order = read(paths[1]);
  assert.ok(order.includes("answer.answerTimeZoneSnapshot"));
  assert.ok(order.includes("answer.answerDateTimeLocalSnapshot.slice(11,16)"));
  assert.ok(order.includes('timeZone="UTC"'));
});
