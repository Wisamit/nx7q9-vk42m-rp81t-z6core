import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  expertDispositionAllowed, validExpertDisposition,
} from "../src/lib/catalog-expert-disposition.ts";
import { catalogDriftObservationToken } from "../src/lib/catalog-drift-triage.ts";

const source = { id: "one", lowValue: "70.000000", criticalLow: "35.000000" };
const live = { id: "one", lowValue: "71.000000", criticalLow: "35.000000" };
const secret = "stage54-strong-test-only-HMAC-key-not-production";
const token = catalogDriftObservationToken(
  secret, "f".repeat(64), 1, "REFERENCE_INTERVAL", source, live,
);
const clinical = new Set(["catalog.manage", "catalog.reference_ranges.manage"]);
const financial = new Set(["catalog.manage", "pricing.manage"]);
const baseline = {
  expertUserId: "expert", batchAuthorId: "author", flagActorUserId: "author",
  eventCategory: "CLINICAL", entityType: "REFERENCE_INTERVAL",
  flaggedEvidence: token, latestEvidence: token,
  sessionPermissions: clinical, livePermissions: clinical,
  isLatestFlag: true, isOpenDraft: true,
};

test("Stage 54: strictly two distinct people and separate verified-domain grants", () => {
  assert.deepEqual(expertDispositionAllowed(baseline), { allowed: true, category: "CLINICAL" });
  for (const change of [
    { expertUserId: "author" },
    { flagActorUserId: "expert" },
    { flagActorUserId: "unknown" },
    { eventCategory: "FINANCIAL" },
    { sessionPermissions: financial },
    { livePermissions: financial },
    { isLatestFlag: false },
    { isOpenDraft: false },
  ]) {
    assert.equal(expertDispositionAllowed({ ...baseline, ...change }).allowed, false);
  }
  const financeSource = { unitPrice: "123.4500", currency: "AED" };
  const financeNow = { unitPrice: "125.0000", currency: "AED" };
  const financeToken = catalogDriftObservationToken(
    secret, "e".repeat(64), 1, "PRICE_LIST_ITEM", financeSource, financeNow,
  );
  assert.equal(expertDispositionAllowed({
    ...baseline, entityType: "PRICE_LIST_ITEM", eventCategory: "FINANCIAL",
    flaggedEvidence: financeToken, latestEvidence: financeToken,
    sessionPermissions: financial, livePermissions: financial,
  }).allowed, true);
  assert.equal(expertDispositionAllowed({
    ...baseline, entityType: "PRICE_LIST_ITEM", eventCategory: "FINANCIAL",
    flaggedEvidence: financeToken, latestEvidence: financeToken,
    livePermissions: clinical,
  }).allowed, false);
});

test("Stage 54: current source/live snapshot and latest referral both required", () => {
  const changed = catalogDriftObservationToken(
    secret, "f".repeat(64), 1, "REFERENCE_INTERVAL",
    source, { ...live, criticalLow: "36.000000" },
  );
  assert.deepEqual(expertDispositionAllowed({
    ...baseline, latestEvidence: changed,
  }), { allowed: false, reason: "expert_evidence_stale" });
  assert.deepEqual(expertDispositionAllowed({
    ...baseline, isLatestFlag: false,
  }), { allowed: false, reason: "expert_evidence_stale" });
  assert.equal(validExpertDisposition("CONFIRM_FINDING"), true);
  assert.equal(validExpertDisposition("RETURN_FOR_CORRECTION"), true);
  assert.equal(validExpertDisposition("APPROVE_PRICE"), false);
  assert.equal(validExpertDisposition("ACTIVATE_REFERENCE_RANGE"), false);
});

test("Stage 54: queue is metadata-only and route decisions append audit without touching live masters", () => {
  const route = readFileSync("src/app/api/catalog/imports/[id]/bundle-drift/route.ts", "utf8");
  const queue = readFileSync("src/app/api/catalog/imports/expert-review-queue/route.ts", "utf8");
  const ui = readFileSync("src/components/catalog-expert-review-queue.tsx", "utf8");
  const page = readFileSync("src/app/catalog/expert-reviews/page.tsx", "utf8");
  const catalog = readFileSync("src/app/catalog/page.tsx", "utf8");
  assert.match(route, /export async function PUT/);
  assert.match(route, /const expertFlag = expert \? await tx\.auditEvent\.findFirst/);
  assert.match(route, /batch\.createdByUserId === session\.user\.id/);
  assert.match(route, /expertDispositionAllowed\(/);
  assert.match(route, /latestFlag\?\.id === expertFlag!\.id/);
  assert.match(route, /CATALOG_BUNDLE_EXPERT_DECISION_RECORDED/);
  assert.match(route, /expert_evidence_stale/);
  assert.match(route, /sourceType: BUNDLE_REVIEW_SOURCE/);
  assert.match(route, /isolationLevel: "RepeatableRead"/);
  assert.match(route, /status: "DRAFT"/);
  assert.match(route, /entityType: "CatalogExpertReviewFlag"/);
  assert.match(route, /approved: false, activated: false, liveWrites: false/);
  assert.doesNotMatch(route, /tx\.(?:labTest|testComponent|unit|referenceInterval|priceList|priceListItem|laboratoryResult|labOrder|catalogImportRow)\.(?:create|update|delete|upsert)/);
  assert.match(queue, /CATALOG_BUNDLE_EXPERT_REVIEW_FLAGGED/);
  assert.match(queue, /CATALOG_BUNDLE_EXPERT_DECISION_RECORDED/);
  assert.match(queue, /triagePermissionScope\(category, currentPermissions\)/);
  assert.match(queue, /scope\.branchId/);
  assert.match(queue, /clinicalImportTestWhere\(scope\)/);
  // Full JSON is read only inside the tenant-locked server transaction to
  // verify the v2 stage seal; it must never leave in queue entries.
  assert.match(queue, /sourceData: true/);
  assert.match(queue, /verifyIndependentExpertStage\(/);
  assert.match(queue, /batchById = verifiedBatches/);
  assert.doesNotMatch(queue, /entries\.push\(\{[\s\S]*?sourceData:/);
  assert.match(ui, /Independent expert review queue/);
  assert.match(ui, /Confirm finding \(not approval\)/);
  assert.match(page, /requirePermission\("catalog.manage"\)/);
  assert.match(catalog, /href="\/catalog\/expert-reviews"/);
});
