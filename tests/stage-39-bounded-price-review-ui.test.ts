import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseStagedPriceReviewPage } from "../src/lib/staged-price-review-response.ts";

const candidate = () => ({
  priceListCode: "LIST-A", testCode: "HGB", unitPrice: "123.4500",
  effectiveFrom: "2026-10-10", effectiveTo: "2026-11-10",
});
const validRow = (rowNumber: number) => ({
  rowNumber, rowStatus: "VALID", candidate: candidate(), currency: "AED",
  disposition: "READY_FOR_GOVERNANCE", issues: [] as string[],
});
const response = (patch: Record<string, unknown> = {}) => ({
  rows: [validRow(1)], nextCursor: null, hasMore: false,
  liveWrites: false, approvalRequired: true, currencyConversion: false, ...patch,
});
const redacted = (status: string, issue: string) => ({
  rowNumber: 1, rowStatus: status,
  candidate: { priceListCode: "", testCode: "", unitPrice: "", effectiveFrom: "", effectiveTo: "" },
  currency: null, disposition: "BLOCKED", issues: [issue],
});

test("Stage 39 accepts only explicit read-only, approval-required, no-conversion pages", () => {
  assert.deepEqual(parseStagedPriceReviewPage(response(), 0).rows, [validRow(1)]);
  for (const fields of [
    { liveWrites: true }, { liveWrites: undefined }, { approvalRequired: false },
    { approvalRequired: undefined }, { currencyConversion: true },
    { currencyConversion: undefined },
  ]) {
    assert.throws(() => parseStagedPriceReviewPage(response(fields), 0), /unexpected_read_only_price_review_response/);
  }
});

test("Stage 39 rejects malformed, unbounded, nonascending and cursor-inconsistent pages", () => {
  assert.throws(() => parseStagedPriceReviewPage(response(), -1));
  assert.throws(() => parseStagedPriceReviewPage(response({ rows: Array.from({ length: 101 }, (_, i) => validRow(i + 1)) }), 0));
  assert.throws(() => parseStagedPriceReviewPage(response({ rows: [validRow(1), validRow(1)] }), 0));
  assert.throws(() => parseStagedPriceReviewPage(response({ rows: [validRow(2), validRow(1)] }), 0));
  assert.throws(() => parseStagedPriceReviewPage(response({ rows: [validRow(1)] }), 1));
  assert.throws(() => parseStagedPriceReviewPage(response({ hasMore: true, nextCursor: null }), 0));
  assert.throws(() => parseStagedPriceReviewPage(response({ hasMore: true, nextCursor: 2 }), 0));
  assert.throws(() => parseStagedPriceReviewPage(response({ hasMore: false, nextCursor: 1 }), 0));
  assert.throws(() => parseStagedPriceReviewPage(response({ hasMore: true, nextCursor: 0, rows: [] }), 0));
  assert.deepEqual(parseStagedPriceReviewPage(response({
    rows: [validRow(101)], nextCursor: 101, hasMore: true,
  }), 100).nextCursor, 101);
});

test("Stage 39 preserves protected price redaction and rejects leaking masked values", () => {
  for (const [status, issue] of [
    ["IMPORTED", "ROW_ALREADY_PROCESSED"],
    ["SKIPPED", "ROW_ALREADY_PROCESSED"],
    ["ERROR", "STAGED_ROW_HAS_ERRORS"],
    ["VALID", "PRICE_LIST_SCOPE_UNRESOLVED"],
  ]) {
    const safe = redacted(status, issue);
    assert.equal(parseStagedPriceReviewPage(response({ rows: [safe] }), 0).rows[0].candidate.unitPrice, "");
    assert.throws(() => parseStagedPriceReviewPage(response({
      rows: [{ ...safe, candidate: { ...safe.candidate, unitPrice: "123.4500" } }],
    }), 0));
    assert.throws(() => parseStagedPriceReviewPage(response({
      rows: [{ ...safe, currency: "AED" }],
    }), 0));
  }
  assert.throws(() => parseStagedPriceReviewPage(response({ rows: [{...validRow(1),issues: ["ROW_ALREADY_PROCESSED"]}] }), 0));
});

test("Stage 39 review UI replaces pages, supports backward/restart and never offers posting", () => {
  const ui = readFileSync("src/components/price-import-reconciliation.tsx", "utf8");
  const page = readFileSync("src/app/catalog/imports/[id]/page.tsx", "utf8");
  const api = readFileSync("src/app/api/catalog/imports/[id]/prices/reconcile/route.ts", "utf8");
  assert.match(ui, /parseStagedPriceReviewPage\(body, after\)/);
  assert.match(ui, /setRows\(page\.rows\)/);
  assert.doesNotMatch(ui, /setRows\(current => \[\.\.\.current/);
  assert.match(ui, /loadPage\(0, \[\]\)/);
  assert.match(ui, /loadPage\(history\[history\.length - 1\], history\.slice\(0, -1\)\)/);
  assert.match(ui, /loadPage\(nextCursor, \[\.\.\.history, cursor\]\)/);
  assert.match(ui, /cache: "no-store"/);
  assert.match(ui, /NOT price approval or financial posting/);
  assert.match(ui, /OVERLAPPING_STAGED_PRICE_WINDOWS/);
  assert.doesNotMatch(ui, /method: "POST"|method: "PATCH"|method: "DELETE"/);
  assert.match(page, /permissions\.has\("pricing\.manage"\) && <PriceImportReconciliation/);
  assert.match(api, /take: PAGE_SIZE \+ 1/);
  assert.match(api, /liveWrites: false, currencyConversion: false/);
  assert.doesNotMatch(api, /priceListItem\.(create|update)|prisma\.\$transaction/);
});
