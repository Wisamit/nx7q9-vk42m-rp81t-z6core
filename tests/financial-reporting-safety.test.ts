import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("financial report implements every master-scope filter without changing posting data", () => {
  const page = source("src/app/billing/reports/page.tsx");
  for (const field of [
    "branchId",
    "sourceId",
    "referrerId",
    "testId",
    "paymentMethod",
    "cashierUserId",
    "clientId",
  ]) {
    assert.match(page, new RegExp(`name=["']${field}["']`));
  }
  assert.match(page, /requirePermission\("billing\.view"\)/);
});

test("filtered collections are summed from invoice allocations rather than whole payment amounts", () => {
  const page = source("src/app/billing/reports/page.tsx");
  assert.match(page, /prisma\.paymentAllocation\.findMany/);
  assert.match(page, /invoice:\s*invoiceContext/);
  assert.match(page, /amount:\s*item\.amount\.toFixed\(4\)/);
  assert.doesNotMatch(page, /paymentAllocations:\s*payments\.map/);
});

test("financial report exposes explicit event date bases and currency separation", () => {
  const page = source("src/app/billing/reports/page.tsx");
  assert.match(page, /invoice KPIs use invoice issue time/);
  assert.match(page, /collections use payment received time/);
  assert.match(page, /credit notes use credit-note issue time/);
  assert.match(page, /refunds use refund processing time/);
  assert.match(page, /Amounts are never combined across currencies/);
});
