import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { summarizeCatalogGovernance, type GovernanceRow } from "../src/lib/catalog-governance-readiness.ts";

const row = (entityType: string, disposition: "DRIFTED" | "UNCHANGED",
  status: GovernanceRow["finding"]["status"]): GovernanceRow => ({
  entityType, disposition, finding: { status },
});

test("Stage 57: full-bundle clinical/financial buckets remain counts-only and signoff is always blocked", () => {
  const result = summarizeCatalogGovernance([
    row("REFERENCE_INTERVAL", "DRIFTED", "AWAITING_EXPERT"),
    row("TEST", "UNCHANGED", "UNFLAGGED"),
    row("COMPONENT", "DRIFTED", "EXPERT_CONFIRMED"),
    row("UNIT", "DRIFTED", "STALE_REVIEW_REQUIRED"),
    row("PRICE_LIST", "DRIFTED", "RETURNED_FOR_CORRECTION"),
    row("PRICE_LIST_ITEM", "DRIFTED", "UNFLAGGED"),
  ], true);
  assert.equal(result.rowCount, 6);
  assert.equal(result.byCategory.CLINICAL.total, 4);
  assert.equal(result.byCategory.CLINICAL.pending, 1);
  assert.equal(result.byCategory.CLINICAL.expertConfirmed, 1);
  assert.equal(result.byCategory.CLINICAL.stale, 1);
  assert.equal(result.byCategory.FINANCIAL.total, 2);
  assert.equal(result.byCategory.FINANCIAL.returnedForCorrection, 1);
  assert.equal(result.totals.drifted, 5);
  assert.equal(result.totals.unflagged, 2);
  assert.equal(result.totals.driftUnflagged, 1);
  assert.equal(result.blockers.includes("DRIFT_NOT_TRIAGED"), true);
  assert.equal(result.blockers.includes("EXPERT_REVIEW_PENDING"), true);
  assert.equal(result.blockers.includes("STALE_REVIEW_EVIDENCE"), true);
  assert.equal(result.blockers.includes("EXPERT_RETURNED_FOR_CORRECTION"), true);
  assert.equal(result.blockers.includes("SOURCE_NOT_ATTESTED"), false);
  assert.equal(result.approved, false);
  assert.equal(result.activationAllowed, false);
  assert.equal(result.clinicalReleaseAllowed, false);
  assert.equal(result.pricePublicationAllowed, false);
  assert.equal(result.liveWrites, false);
  assert.doesNotMatch(JSON.stringify(result), /lowValue|criticalLow|unitPrice|patientId/);
});

test("Stage 57: an attested fully-reviewed snapshot is still NOT clinical/finance signoff", () => {
  const report = summarizeCatalogGovernance([
    row("REFERENCE_INTERVAL", "DRIFTED", "EXPERT_CONFIRMED"),
    row("PRICE_LIST_ITEM", "DRIFTED", "EXPERT_CONFIRMED"),
    row("TEST", "UNCHANGED", "UNFLAGGED"),
  ], true);
  assert.deepEqual(report.blockers, [
    "SIGNATORY_POLICY_UNCONFIGURED", "APPLICATION_WORKFLOW_UNAVAILABLE",
  ]);
  assert.equal(report.activationAllowed, false);
  assert.equal(report.approved, false);
  assert.equal(report.rowCount, 3);
  assert.equal(report.totals.driftUnflagged, 0);
  const unsigned = summarizeCatalogGovernance([
    row("TEST", "UNCHANGED", "UNFLAGGED"),
  ], false);
  assert.ok(unsigned.blockers.includes("SOURCE_NOT_ATTESTED"));
  assert.equal(unsigned.activationAllowed, false);
  const empty = summarizeCatalogGovernance([], true);
  assert.equal(empty.rowCount, 0);
  assert.equal(empty.approved, false);
  assert.ok(empty.blockers.includes("SIGNATORY_POLICY_UNCONFIGURED"));
});

test("Stage 57: unknown category/lifecycle or disposition fails closed", () => {
  assert.throws(() => summarizeCatalogGovernance([
    row("PATIENT", "DRIFTED", "UNFLAGGED"),
  ], true), /unknown_entity_type/);
  assert.throws(() => summarizeCatalogGovernance([
    row("TEST", "DRIFTED", "ACTIVATED" as GovernanceRow["finding"]["status"]),
  ], true), /unknown_finding/);
  assert.throws(() => summarizeCatalogGovernance([
    row("TEST", "REMOVED" as "UNCHANGED", "UNFLAGGED"),
  ], true), /unknown_disposition/);
});

test("Stage 57: governance GET uses all authorized staged identities in one transaction", () => {
  const route = readFileSync("src/app/api/catalog/imports/[id]/bundle-drift/route.ts", "utf8");
  const page = readFileSync("src/app/catalog/imports/[id]/page.tsx", "utf8");
  const ui = readFileSync("src/components/catalog-governance-readiness.tsx", "utf8");
  assert.match(route, /query\.get\("governance"\) !== "1"/);
  assert.match(route, /inspectBundleDrift\(request, context, null, null, false, true\)/);
  assert.match(route, /governance\s*\?\s*staged\s*:\s*staged\.filter/);
  assert.match(route, /governance \? page : page\.slice/);
  assert.match(route, /governance \? 25001 : 1001/);
  assert.match(route, /review_history_limit_exceeded/);
  assert.match(route, /review_decision_integrity_error/);
  assert.match(route, /summarizeCatalogGovernance\(displayed, verified\)/);
  assert.match(route, /isolationLevel: "RepeatableRead"/);
  assert.match(route, /createdByUserId: session\.user\.id/);
  assert.match(route, /reconciliation_parent_scope_changed/);
  assert.match(route, /reconciliation_live_master_scope_changed/);
  assert.match(route, /CATALOG_BUNDLE_GOVERNANCE_INSPECTED/);
  assert.doesNotMatch(route, /tx\.(?:labTest|testComponent|unit|referenceInterval|priceList|priceListItem|catalogImportRow)\.(?:create|update|upsert|delete)/);
  assert.match(ui, /\?governance=1/);
  assert.match(ui, /activationAllowed !== false/);
  assert.match(ui, /SIGNATORY_POLICY_UNCONFIGURED/);
  assert.match(ui, /الاعتماد والتفعيل النهائي: محظور/);
  assert.match(page, /CatalogGovernanceReadiness batchId=\{batch\.id\}/);
});
