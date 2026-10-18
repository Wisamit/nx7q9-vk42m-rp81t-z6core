import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { isRecoverableStageSource, validateCatalogStageRecovery } from "../src/lib/catalog-stage-recovery.ts";

const source = (path: string) => readFileSync(path, "utf8");
test("recovery accepts only the three existing source types and an exact server receipt", () => {
  for (const type of ["LEGACY_MDB_EXPORT", "CSV_REVIEW", "CONFIG_BUNDLE_REVIEW"])
    assert.equal(isRecoverableStageSource(type), true);
  for (const type of [null, "", "IMPORTED", "PRICING", "CSV_REVIEW&key=other"])
    assert.equal(isRecoverableStageSource(type), false);
  const id = randomUUID();
  assert.equal(validateCatalogStageRecovery({ found: true, id }), id);
  for (const value of [null, {}, [], { found: false, id }, { id },
    { found: true, id: "other" }, { found: true, id: 5 }])
    assert.equal(validateCatalogStageRecovery(value), null);
});

test("read-only recovery is locked, live-authorized and actor/tenant/source/key scoped", () => {
  const api = source("src/app/api/catalog/imports/recovery/route.ts");
  for (const required of [
    'export async function GET(request: Request)',
    'requirePermission("catalog.manage")',
    'isRecoverableStageSource(sourceType)',
    'catalogStageSubmissionKey(request.headers.get("x-family-lab-staging-key"))',
    'if (!isRecoverableStageSource(sourceType) || !key.valid || !key.key)',
    "FOR UPDATE", "catalogImportBatch.findFirst",
    "organizationId: session.user.organizationId",
    "createdByUserId: session.user.id",
    "sourceType,", "submissionKey: key.key",
    "catalogImportRow.groupBy",
    "liveCatalogReviewStagingAuthority(tx",
    "needsPricing:", "needsRanges:", "needsClinicalScope:",
    'kind: "absent"', 'kind: "denied"',
    '"Cache-Control": "private, no-store"',
  ]) assert.ok(api.includes(required), "Missing: " + required);
  for (const mutation of [".create(", ".update(", ".delete(", "createMany(", "updateMany(",
    "POST(", "catalogImportRow.findMany("])
    assert.ok(!api.includes(mutation), "Unexpected recovery mutation: " + mutation);
});

test("all three original POST clients expose only an explicit read-only recovery action", () => {
  const component = source("src/components/catalog-stage-recovery-button.tsx");
  assert.ok(component.includes('method: "GET"'));
  assert.ok(component.includes('validateCatalogStageRecovery(body)'));
  assert.ok(!component.includes('method: "POST"'));
  assert.ok(component.includes('busyRef.current'));
  assert.ok(component.includes('response.status === 403'));
  for (const [path, expected] of [
    ["src/components/legacy-import-batches.tsx", "LEGACY_MDB_EXPORT"],
    ["src/components/catalog-csv-review-staging.tsx", "CSV_REVIEW"],
    ["src/components/catalog-bundle-review-staging.tsx", "CONFIG_BUNDLE_REVIEW"],
  ]) {
    const ui = source(path);
    assert.ok(ui.includes('<CatalogStageRecoveryButton'), path);
    assert.ok(ui.includes('sourceType="' + expected + '"'), path);
    assert.ok(ui.includes('submissionKey={submissionKey.current}'), path);
    assert.ok(ui.includes("retryBlocked"), path);
    assert.ok(ui.includes("setRetryBlocked(true)"), path);
    assert.ok(!ui.includes("setRetryBlocked(false)"), path);
  }
});
