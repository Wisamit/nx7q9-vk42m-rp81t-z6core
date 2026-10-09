import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  calendarInstant, overlaps, reconcilePriceCandidate, validPriceDecimal,
} from "../src/lib/price-import-reconciliation.ts";

const candidate = {
  priceListCode: "PL1", testCode: "T1", unitPrice: "12345678901234.1234",
  effectiveFrom: "2026-10-01", effectiveTo: "2026-10-31",
};
const masters = {
  lists: new Map([["PL1", {
    id: "LIST1", status: "ACTIVE", currency: "AED",
    effectiveFrom: "2026-01-01", effectiveTo: null,
  }]]),
  tests: new Map([["T1", { id: "TEST1", status: "ACTIVE" }]]),
  existing: new Map<string, Array<{ effectiveFrom: string; effectiveTo: string | null }>>(),
};

test("exact financial precision stays string-based and bounded by DECIMAL(18,4)", () => {
  for (const amount of ["0", "0.0000", "1.1000", "12345678901234.1234"]) {
    assert.equal(validPriceDecimal(amount), true, amount);
  }
  for (const amount of ["", "-1", "1.12345", "1e4", "1,000", "01", "123456789012345.0000"]) {
    assert.equal(validPriceDecimal(amount), false, amount);
  }
  assert.equal(reconcilePriceCandidate(candidate, masters, 1).disposition, "READY_FOR_GOVERNANCE");
});

test("tenant-filtered index, inactive masters and unapproved currencies fail closed", () => {
  assert.ok(reconcilePriceCandidate({ ...candidate, priceListCode: "OTHER" }, masters, 1)
    .issues.includes("PRICE_LIST_NOT_ACTIVE_OR_AUTHORIZED"));
  assert.ok(reconcilePriceCandidate({ ...candidate, testCode: "OTHER" }, masters, 1)
    .issues.includes("TEST_NOT_ACTIVE_OR_AUTHORIZED"));
  const inactive = { ...masters, lists: new Map([["PL1", { ...masters.lists.get("PL1")!, status: "INACTIVE" }]]) };
  assert.equal(reconcilePriceCandidate(candidate, inactive, 1).disposition, "BLOCKED");
  const malformed = { ...masters, lists: new Map([["PL1", { ...masters.lists.get("PL1")!, currency: "" }]]) };
  assert.ok(reconcilePriceCandidate(candidate, malformed, 1).issues.includes("PRICE_LIST_CURRENCY_INVALID"));
});

test("date intervals are strictly checked; overlapping staged/live prices block governance", () => {
  assert.equal(calendarInstant("2026-02-30"), null);
  assert.equal(calendarInstant("2026-10-01T12:00:00.000Z") !== null, true);
  assert.equal(calendarInstant("10/01/2026"), null);
  assert.equal(overlaps("2026-10-01", "2026-10-31", "2026-11-01", null), false);
  assert.equal(overlaps("2026-10-01", "2026-10-31", "2026-10-31", null), true);
  assert.ok(reconcilePriceCandidate({ ...candidate, effectiveTo: "2026-09-01" }, masters, 1)
    .issues.includes("INVALID_EFFECTIVE_WINDOW"));
  assert.ok(reconcilePriceCandidate(candidate, masters, 2).issues.includes("OVERLAPPING_STAGED_PRICE_WINDOWS"));
  const existing = { ...masters, existing: new Map([["LIST1|TEST1", [
    { effectiveFrom: "2026-10-20", effectiveTo: "2026-12-01" },
  ]]]) };
  assert.ok(reconcilePriceCandidate(candidate, existing, 1).issues.includes("EXISTING_PRICE_WINDOW_COLLISION"));
  const restrictedWindow = { ...masters, lists: new Map([["PL1", {
    ...masters.lists.get("PL1")!, effectiveTo: "2026-10-15",
  }]]) };
  assert.ok(reconcilePriceCandidate(candidate, restrictedWindow, 1)
    .issues.includes("OUTSIDE_PRICE_LIST_EFFECTIVE_WINDOW"));
});

test("API has permission, tenant, branch and department protections and no financial mutation", () => {
  const s = readFileSync(new URL("../src/app/api/catalog/imports/[id]/prices/reconcile/route.ts", import.meta.url), "utf8");
  assert.ok(s.includes('requirePermission("pricing.manage")'));
  assert.ok(s.includes('permissionSet(session).has("catalog.manage")'));
  assert.ok(s.includes("organizationId"));
  assert.ok(s.includes("branchId: { in: branches }"));
  assert.ok(s.includes("departmentId: { in: departments }"));
  assert.ok(s.includes('entityType: "PRICE_LIST_ITEM"'));
  assert.ok(s.includes("take: PAGE_SIZE + 1"));
  assert.ok(s.includes("currencyConversion: false"));
  assert.ok(s.includes("liveWrites: false"));
  assert.ok(!s.includes("priceListItem.create("));
  assert.ok(!s.includes("priceListItem.update("));
  assert.ok(!s.includes("catalogImportRow.update("));
  const commit = readFileSync(new URL("../src/app/api/catalog/imports/[id]/commit/route.ts", import.meta.url), "utf8");
  assert.ok(commit.includes('["REFERENCE_INTERVAL", "COMPONENT", "PRICE_LIST_ITEM"]'));
});

test("bilingual UI explicitly warns against financial posting and is permission gated", () => {
  const s = readFileSync(new URL("../src/components/price-import-reconciliation.tsx", import.meta.url), "utf8");
  const p = readFileSync(new URL("../src/app/catalog/imports/[id]/page.tsx", import.meta.url), "utf8");
  assert.ok(s.includes("NOT price approval or financial posting"));
  assert.ok(s.includes("وليست اعتماداً للأسعار"));
  assert.ok(p.includes('permissions.has("pricing.manage")'));
  assert.ok(p.includes('permissions.has("catalog.manage")'));
});
