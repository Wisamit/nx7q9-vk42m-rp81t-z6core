import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { catalogExportTypes } from "../src/lib/catalog-configuration-export.ts";
import {
  bundleTriageClass, catalogDriftObservationToken,
  triagePermissionScope,
} from "../src/lib/catalog-drift-triage.ts";
import { expertDispositionAllowed } from "../src/lib/catalog-expert-disposition.ts";
import { summarizeCatalogGovernance } from "../src/lib/catalog-governance-readiness.ts";

const expected = {
  TEST: "CLINICAL", COMPONENT: "CLINICAL", UNIT: "CLINICAL",
  CONTAINER: "CLINICAL", PANEL: "CROSS_DOMAIN", PACKAGE: "CROSS_DOMAIN",
  REFERENCE_INTERVAL: "CLINICAL",
  PRICE_LIST: "FINANCIAL", PRICE_LIST_ITEM: "FINANCIAL",
  PRICE_LIST_PACKAGE_ITEM: "FINANCIAL",
} as const;
const author = new Set(["catalog.manage"]);
const clinical = new Set(["catalog.manage", "catalog.reference_ranges.manage"]);
const finance = new Set(["catalog.manage", "pricing.manage"]);
const both = new Set(["catalog.manage", "catalog.reference_ranges.manage", "pricing.manage"]);
const key = "synthetic-f2-triage-test-secret-32-character-minimum";
const checksum = "e".repeat(64);

test("F2: every atomic exported class has exactly one review domain; unknown types fail closed", () => {
  assert.deepEqual(new Set(Object.keys(expected)), catalogExportTypes);
  for (const [type, category] of Object.entries(expected)) {
    assert.equal(bundleTriageClass(type), category, type);
    const observation = catalogDriftObservationToken(key, checksum, 1, type,
      { id: "synthetic", status: "DRAFT" }, { id: "synthetic", status: "ACTIVE" });
    assert.match(observation, /^[a-f0-9]{64}$/, type);
  }
  assert.equal(bundleTriageClass("PATIENT"), null);
  assert.throws(() => catalogDriftObservationToken(key, checksum, 1, "PATIENT", {}, {}),
    /invalid_drift_observation_identity/);
});

test("F2: no single clinical or finance grant can review a composite clinical/commercial definition", () => {
  for (const category of ["CLINICAL", "FINANCIAL", "CROSS_DOMAIN"] as const)
    assert.equal(triagePermissionScope(category, author), false);
  assert.equal(triagePermissionScope("CLINICAL", clinical), true);
  assert.equal(triagePermissionScope("CLINICAL", finance), false);
  assert.equal(triagePermissionScope("FINANCIAL", finance), true);
  assert.equal(triagePermissionScope("FINANCIAL", clinical), false);
  assert.equal(triagePermissionScope("CROSS_DOMAIN", clinical), false);
  assert.equal(triagePermissionScope("CROSS_DOMAIN", finance), false);
  assert.equal(triagePermissionScope("CROSS_DOMAIN", both), true);
  assert.equal(triagePermissionScope("CROSS_DOMAIN", new Set(["pricing.manage","catalog.reference_ranges.manage"])), false);
});

test("F2: independent expert finding disposition is possible for every class but never activates a master", () => {
  for (const type of catalogExportTypes) {
    const domain = bundleTriageClass(type)!;
    const token = catalogDriftObservationToken(key, checksum, 3, type,
      { id: "source" }, { id: "new-live" });
    const p = domain === "CLINICAL" ? clinical : domain === "FINANCIAL" ? finance : both;
    const base = {
      expertUserId: "reviewer", batchAuthorId: "author", flagActorUserId: "author",
      eventCategory: domain, entityType: type,
      flaggedEvidence: token, latestEvidence: token,
      sessionPermissions: p, livePermissions: p, isLatestFlag: true, isOpenDraft: true,
    };
    assert.deepEqual(expertDispositionAllowed(base), { allowed: true, category: domain }, type);
    assert.equal(expertDispositionAllowed({ ...base, livePermissions: author }).allowed, false, type);
    assert.equal(expertDispositionAllowed({ ...base, expertUserId: "author" }).allowed, false, type);
    assert.equal(expertDispositionAllowed({ ...base, latestEvidence: "0".repeat(64) }).allowed, false, type);
  }
});

test("F2: full ten-class governance is counts-only and never authorizes any application", () => {
  const result = summarizeCatalogGovernance([...catalogExportTypes].map(entityType => ({
    entityType, disposition: "DRIFTED" as const, finding: { status: "UNFLAGGED" as const },
  })), true);
  assert.equal(result.rowCount, 10);
  assert.equal(result.byCategory.CLINICAL.total, 5);
  assert.equal(result.byCategory.CROSS_DOMAIN.total, 2);
  assert.equal(result.byCategory.FINANCIAL.total, 3);
  assert.equal(result.totals.driftUnflagged, 10);
  assert.ok(result.blockers.includes("DRIFT_NOT_TRIAGED"));
  assert.ok(result.blockers.includes("SIGNATORY_POLICY_UNCONFIGURED"));
  assert.equal(result.reviewOnly, true);
  assert.equal(result.approved, false);
  assert.equal(result.activationAllowed, false);
  assert.equal(result.liveWrites, false);
});

test("F2: review endpoints preserve transaction-scoped domain permissions and review-only commit denial", () => {
  const drift = readFileSync("src/app/api/catalog/imports/[id]/bundle-drift/route.ts", "utf8");
  const queue = readFileSync("src/app/api/catalog/imports/expert-review-queue/route.ts", "utf8");
  const commit = readFileSync("src/app/api/catalog/imports/[id]/commit/route.ts", "utf8");
  assert.match(drift, /triagePermissionScope\(category, livePermissions\)/);
  assert.match(drift, /triagePermissionScope\(category, sessionPermissions\)/);
  assert.match(drift, /summarizeCatalogGovernance\(displayed, verified\)/);
  assert.match(queue, /triagePermissionScope\(category, currentPermissions\)/);
  assert.match(commit, /CONFIG_BUNDLE_REVIEW/);
  assert.match(commit, /csv_review_is_not_committable/);
});
