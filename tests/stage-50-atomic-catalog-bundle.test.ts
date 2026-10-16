import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  BUNDLE_REVIEW_MAX_BYTES, BUNDLE_REVIEW_MAX_ROWS,
  parseCatalogBundleForReview,
} from "../src/lib/catalog-bundle-review.ts";

const exporter = readFileSync("src/app/api/catalog/configuration-export/bundle/route.ts", "utf8");
const importer = readFileSync("src/app/api/catalog/imports/bundle/route.ts", "utf8");
const ui = readFileSync("src/components/catalog-configuration-export.tsx", "utf8");

test("Stage 50: one repeatable-read transaction encloses live grants, all six queries, audit and bounded response", () => {
  const lock = exporter.indexOf("const orgLock = await tx.$queryRaw");
  const grants = exporter.indexOf("const liveBranches = await tx.userBranchScope.findMany");
  const departments = exporter.indexOf("const liveDepartments = await tx.userDepartmentScope.findMany");
  const query = exporter.indexOf('if (type === "TEST")');
  const audit = exporter.indexOf('action: "CATALOG_CONFIGURATION_ATOMIC_BUNDLE_EXPORTED"');
  assert.ok(lock > 0 && grants > lock && departments > grants && query > departments && audit > query);
  assert.match(exporter, /isolationLevel: "RepeatableRead"/);
  assert.match(exporter, /FOR UPDATE/);
  assert.match(exporter, /sessionBranches\.has\(id\)/);
  assert.match(exporter, /sessionDepartments\.has\(item\.departmentId\)/);
  assert.match(exporter, /restrictedDepartments && currentDepartments\.length === 0/);
  assert.match(exporter, /resolveClinicalImportScope/);
  assert.match(exporter, /clinicalImportTestWhere\(liveScope\)/);
  assert.match(exporter, /records\.length \+ total > BUNDLE_REVIEW_MAX_ROWS/);
  assert.match(exporter, /Buffer\.byteLength\(serialized, "utf8"\) > BUNDLE_REVIEW_MAX_BYTES/);
  assert.match(exporter, /genericCatalogPriceScope\\(branchIds\\)/);
  const scope = readFileSync("src/lib/catalog-generic-price-scope.ts","utf8");
  assert.match(scope, /scopeType: "ORGANIZATION"/);
  assert.match(scope, /scopeType: "BRANCH"/);
  for (const field of ["sourceId", "referrerId", "clientId", "contractId"]) {
    assert.match(scope, new RegExp(field + ": null"));
  }
  assert.doesNotMatch(exporter, /scopeType: "CLIENT"/);
  assert.doesNotMatch(exporter, /scopeType: "CONTRACT"/);
  assert.doesNotMatch(exporter, /tx\.(?:labTest|testComponent|referenceInterval|priceListItem)\.(?:create|update|upsert)/);
  assert.match(ui, /configuration-export\/bundle\?types=/);
  assert.match(ui, /transactional-consistent-read/);
  assert.equal(BUNDLE_REVIEW_MAX_BYTES, 4 * 1024 * 1024);
  assert.equal(BUNDLE_REVIEW_MAX_ROWS, 5000);
});

test("Stage 50: atomic provenance is accepted as DRAFT source only, legacy non-atomic source remains correctly warned", () => {
  const org = "11111111-1111-4111-8111-111111111111";
  const id = "22222222-2222-4222-8222-222222222222";
  const template = {
    format: "family-lab-catalog-bundle", schemaVersion: 1,
    organizationId: org, exportedAt: "2026-10-10T00:00:00.000Z",
    groups: [{ entityType: "TEST", records: [{
      id, code: "T50", nameEn: "Test", departmentId: null, status: "ACTIVE",
    }] }],
  };
  const atomic = parseCatalogBundleForReview({
    ...template, consistency: "transactional-consistent-read",
  }, org, { pricing: false, ranges: false });
  const old = parseCatalogBundleForReview({
    ...template, consistency: "paged-live-not-atomic",
  }, org, { pricing: false, ranges: false });
  assert.equal(atomic.consistency, "transactional-consistent-read");
  assert.equal(old.consistency, "paged-live-not-atomic");
  assert.deepEqual(atomic.rows, old.rows);
  assert.match(importer, /consistency: parsed\.consistency/);
  assert.match(importer, /parsed\.consistency === "paged-live-not-atomic"/);
  assert.match(importer, /status: "DRAFT", validatedAt: null/);
  assert.match(importer, /status: "WARNING"/);
  assert.match(importer, /CONFIGURATION_BUNDLE_REVIEW_ONLY/);
  assert.doesNotMatch(importer, /tx\.(?:labTest|testComponent|referenceInterval|priceListItem)\.(?:create|update|upsert)/);
});
