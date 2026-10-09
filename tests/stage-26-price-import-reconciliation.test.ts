import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { parseImportDate, reconcilePriceCandidate } from "../src/lib/price-import-reconciliation.ts";

const candidate = { priceListCode: "BASE", testCode: "CBC", unitPrice: "123.4567", effectiveFrom: "2026-10-10", effectiveTo: "" };
const context = {
  lists: new Map([["BASE", { id: "price-list", currency: "AED", status: "ACTIVE",
    effectiveFrom: new Date("2026-01-01T00:00:00Z"), effectiveTo: null }]]),
  tests: new Map([["CBC", { id: "test", status: "ACTIVE" }]]),
  existing: [] as Array<{ priceListId: string; testId: string; effectiveFrom: Date; effectiveTo: Date | null }>,
};
test("price imports require strict dates and exact decimal strings", () => {
  assert.equal(parseImportDate("2026-02-30"), null);
  assert.equal(parseImportDate("2026-02-28")?.toISOString().slice(0, 10), "2026-02-28");
  for (const bad of ["1e3", "-1", "0.00001", "100000000000000", "01.00", "1.00000"]) {
    assert.ok(reconcilePriceCandidate({ ...candidate, unitPrice: bad }, context, 1).issues.includes("INVALID_DECIMAL_PRICE"), bad);
  }
  assert.equal(reconcilePriceCandidate(candidate, context, 1).disposition, "READY_FOR_GOVERNANCE");
});
test("conflicts and ambiguous identities block financial governance readiness", () => {
  assert.ok(reconcilePriceCandidate(candidate, context, 2).issues.includes("DUPLICATE_STAGED_PRICE_IDENTITY"));
  assert.ok(reconcilePriceCandidate({ ...candidate, priceListCode: "OTHER" }, context, 1).issues.includes("PRICE_LIST_NOT_ACTIVE_OR_MISSING"));
  assert.ok(reconcilePriceCandidate({ ...candidate, effectiveTo: "2026-10-09" }, context, 1).issues.includes("INVALID_EFFECTIVE_WINDOW"));
  const overlapping = { ...context, existing: [{
    priceListId: "price-list", testId: "test",
    effectiveFrom: new Date("2026-10-09T00:00:00Z"), effectiveTo: null,
  }] };
  assert.ok(reconcilePriceCandidate(candidate, overlapping, 1).issues.includes("EXISTING_PRICE_WINDOW_OVERLAP"));
});
test("server-side route stays tenant and permission scoped, review only", () => {
  const route = readFileSync("src/app/api/catalog/imports/[id]/prices/reconcile/route.ts", "utf8");
  assert.match(route, /requirePermission\("pricing\.manage"\)/);
  assert.match(route, /requirePermission\("catalog\.manage"\)/);
  assert.match(route, /organizationId: session\.user\.organizationId/);
  assert.match(route, /take: PAGE_SIZE \+ 1/);
  assert.match(route, /approvalRequired: true, liveWrites: false/);
  assert.doesNotMatch(route, /tx\.priceListItem\.create|prisma\.priceListItem\.create|prisma\.priceListItem\.update/);
});
