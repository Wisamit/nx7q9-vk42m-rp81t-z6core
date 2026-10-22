import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  bundleTriageClass, catalogDriftObservationToken, matchesCatalogDriftObservation,
  triagePermissionScope, validTriageReason,
} from "../src/lib/catalog-drift-triage.ts";

const checksum = "a".repeat(64);
const key = "stage53-hmac-key-strictly-used-in-tests-123";
const before = { lowValue: "70.000000", criticalLow: "45.000000", status: "ACTIVE",
  scope: { branchId: "123" }, updatedAt: "2026-10-10T11:00:00.000Z" };
const now = structuredClone(before);
const token = () => catalogDriftObservationToken(key, checksum, 1, "REFERENCE_INTERVAL", before, now);

test("Stage 53: current snapshot HMAC cannot be reused when any clinically or financially material value changes", () => {
  const observed = token();
  assert.match(observed, /^[0-9a-f]{64}$/);
  assert.equal(matchesCatalogDriftObservation(observed, token()), true);
  assert.equal(matchesCatalogDriftObservation(observed, catalogDriftObservationToken(
    key, checksum, 1, "REFERENCE_INTERVAL", before, { ...now, lowValue: "70.000001" }
  )), false);
  assert.equal(matchesCatalogDriftObservation(observed, catalogDriftObservationToken(
    key, checksum, 1, "REFERENCE_INTERVAL", before, { ...now, criticalLow: "40.000000" }
  )), false);
  assert.equal(matchesCatalogDriftObservation(observed, catalogDriftObservationToken(
    key, checksum, 1, "REFERENCE_INTERVAL", before, { ...now, updatedAt: "2026-10-10T11:00:01.000Z" }
  )), false);
  assert.equal(matchesCatalogDriftObservation(observed, catalogDriftObservationToken(
    key, checksum, 2, "REFERENCE_INTERVAL", before, now
  )), false);
  assert.equal(matchesCatalogDriftObservation(observed, catalogDriftObservationToken(
    key, "b".repeat(64), 1, "REFERENCE_INTERVAL", before, now
  )), false);
  assert.equal(matchesCatalogDriftObservation(observed, catalogDriftObservationToken(
    "another-HMAC-key-for-strict-triage-tests-123", checksum, 1, "REFERENCE_INTERVAL", before, now
  )), false);
  assert.equal(matchesCatalogDriftObservation("not-a-token", observed), false);
  assert.equal(matchesCatalogDriftObservation(null, observed), false);
  assert.throws(() => catalogDriftObservationToken(key, "", 1, "REFERENCE_INTERVAL", before, now));
  assert.throws(() => catalogDriftObservationToken(key, checksum, 0, "REFERENCE_INTERVAL", before, now));
});

test("Stage 53: medical/financial categories and independent live permissions fail closed", () => {
  for (const type of ["REFERENCE_INTERVAL", "TEST", "COMPONENT", "UNIT"]) {
    assert.equal(bundleTriageClass(type), "CLINICAL");
  }
  for (const type of ["PRICE_LIST", "PRICE_LIST_ITEM"]) assert.equal(bundleTriageClass(type), "FINANCIAL");
  assert.equal(bundleTriageClass("PATIENT"), null);
  const general = new Set(["catalog.manage"]);
  assert.equal(triagePermissionScope("CLINICAL", general), false);
  assert.equal(triagePermissionScope("FINANCIAL", general), false);
  assert.equal(triagePermissionScope("CLINICAL", new Set(["catalog.manage", "catalog.reference_ranges.manage"])), true);
  assert.equal(triagePermissionScope("FINANCIAL", new Set(["catalog.manage", "pricing.manage"])), true);
  assert.equal(triagePermissionScope("FINANCIAL", new Set(["pricing.manage"])), false);
  assert.equal(validTriageReason("SOURCE_VALUE_CHANGED"), true);
  assert.equal(validTriageReason("FOLLOW_UP_REQUIRED"), true);
  assert.equal(validTriageReason("automatic_approval"), false);
});

test("Stage 53: bound idempotent input and append-only evidence, never writes laboratory masters", () => {
  const actual=readFileSync("src/app/api/catalog/imports/[id]/bundle-drift/route.ts","utf8");
  const loadCall="const live = await readCatalogLiveObservations(tx,liveScope,branchIds,idsByType);";
  assert.ok(actual.includes(loadCall),"author drift must invoke canonical full live reader");
  const source=actual.replace(loadCall,readFileSync("src/lib/catalog-live-observation.ts","utf8"));
  const ui = readFileSync("src/components/catalog-bundle-drift-review.tsx", "utf8");
  const lock = source.indexOf("const orgLock = await tx.$queryRaw");
  const liveRoles = source.indexOf("const activeUser = await tx.user.findFirst");
  const liveMasters = source.indexOf('if (type === "TEST")');
  const triage = source.indexOf("if (triage) {");
  const audit = source.lastIndexOf('action: "CATALOG_BUNDLE_EXPERT_REVIEW_FLAGGED"');
  assert.ok(lock > 0 && liveRoles > lock && liveMasters > liveRoles && triage > liveMasters && audit > triage);
  assert.match(source, /sessionPermissions\.has\(code\) && livePermissions\.has\(code\)/);
  assert.match(source, /createdByUserId: session.user.id/);
  assert.match(source, /sourceType: BUNDLE_REVIEW_SOURCE/);
  assert.match(source, /status: "DRAFT"/);
  assert.match(source, /if \(!matchesCatalogDriftObservation/);
  assert.match(source, /triage_stale_observation/);
  assert.match(source, /triage_domain_permission_required/);
  assert.match(source, /triage_reason_incompatible/);
  assert.match(source, /rowNumber: observed.rowNumber/);
  assert.match(source, /approved: false, activated: false/);
  assert.match(source, /entityType: "CatalogImportRow"/);
  assert.match(source, /newValues: \{[\s\S]*?evidenceToken: observed.observationToken/);
  assert.doesNotMatch(source, /tx\.(?:labTest|testComponent|unit|referenceInterval|priceList|priceListItem|result|labOrder)\.(?:create|update|upsert|delete)/);
  assert.match(ui, /Flag for expert review/);
  assert.match(ui, /observationToken: row.observationToken/);
  assert.match(ui, /result\.approved !== false/);
});
