import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("Stage 126: safe composite creation rechecks live clinical branch and department scopes", () => {
  const helper = readFileSync("src/lib/catalog-composite-write.ts", "utf8");
  const panel = readFileSync("src/app/api/catalog/panels/route.ts", "utf8");
  const pkg = readFileSync("src/app/api/catalog/packages/route.ts", "utf8");
  assert.match(helper, /FOR UPDATE/);
  assert.match(helper, /isolationLevel: "Serializable"/);
  assert.match(helper, /resolveClinicalImportScope/);
  assert.match(helper, /clinicalImportTestWhere/);
  assert.match(helper, /userDepartmentScope\.findMany/);
  assert.match(helper, /userBranchScope\.findMany/);
  assert.match(helper, /intersectCompositeDepartments/);
  assert.match(helper, /composite_department_scope_revoked/);
  for (const source of [panel, pkg]) {
    assert.match(source, /withScopedCompositeCreation/);
    assert.match(source, /parseCompositeMembers/);
    assert.match(source, /\.createMany/);
    assert.match(source, /scopedMembership: true/);
    assert.doesNotMatch(source, /prisma\.labTest\.findMany/);
    assert.doesNotMatch(source, /tx\.(testPanelItem|commercialPackageItem)\.deleteMany/);
  }
});
test("Stage 126: membership input refuses implicit code/label mapping, duplicate, and malformed order", () => {
  const helper = readFileSync("src/lib/catalog-composite-write.ts", "utf8");
  assert.match(helper, /composite_multiple_membership_sources/);
  assert.match(helper, /composite_duplicate_member/);
  assert.match(helper, /typeof required !== "boolean"/);
  assert.match(helper, /displayOrder/);
  assert.match(helper, /raw\.length > 300/);
  assert.match(helper, /seenTest/);
  assert.match(helper, /seenOrder/);
});

test("Stage 126: bundle drift includes all nine classes with full related scope", () => {
  const driftRoute = readFileSync("src/app/api/catalog/imports/[id]/bundle-drift/route.ts", "utf8");
  const liveSelect = readFileSync("src/lib/catalog-live-observation.ts", "utf8");
  assert.match(driftRoute,/readCatalogLiveObservations\(tx,liveScope,branchIds,idsByType\)/);
  const drift = driftRoute + "\n" + liveSelect;
  const source = readFileSync("src/app/api/catalog/configuration-export/bundle/route.ts", "utf8");
  for (const entity of ["PANEL","PACKAGE","PRICE_LIST_PACKAGE_ITEM"]) {
    assert.ok(drift.includes('type === "' + entity + '"'));
    assert.ok(source.includes('type === "' + entity + '"'));
  }
  assert.match(drift, /items: fullyVisibleItems/);
  assert.match(drift, /every: \{ test: testScope \}/);
  assert.match(drift, /reconciliation_composite_membership_missing/);
  assert.match(drift, /reconciliation_composite_member_invalid/);
  assert.match(drift, /mappedPackages !== packageRefs\.size/);
  assert.match(drift, /tx\.priceListPackageItem\.findMany/);
  assert.match(drift, /sourceId: null, referrerId: null, clientId: null, contractId: null/);
  assert.match(drift, /unitPrice: true/);
});

test("Stage 126: legacy clinical import does not mutate active unit or activate generated component", () => {
  const api = readFileSync("src/app/api/catalog/imports/[id]/reference-ranges/route.ts", "utf8");
  assert.match(api, /approvalStatus: "DRAFT"/);
  assert.match(api, /status: "INACTIVE"/);
  assert.match(api, /defaultTestUnitsUnchanged: true/);
  assert.match(api, /newComponentsInactive: true/);
  assert.doesNotMatch(api, /tx\.labTest\.update\(/);
});

test("Stage 126: financial source prices are created as inactive exact-decimal drafts only", () => {
  const code = readFileSync("src/app/api/catalog/imports/[id]/price-drafts/route.ts", "utf8");
  assert.match(code, /requirePermission\("pricing\.manage"\)/);
  assert.match(code, /withScopedCompositeCreation/);
  assert.match(code, /sourceType: "LEGACY_MDB_EXPORT"/);
  assert.match(code, /reconcilePriceCandidate/);
  assert.match(code, /stagedPriceOverlapIndex/);
  assert.match(code, /clinicalImportTestWhere/);
  assert.match(code, /unitPrice: new Prisma\.Decimal\(candidate\.unitPrice\)/);
  assert.match(code, /status: "INACTIVE", deactivatedAt: new Date\(\)/);
  assert.match(code, /financialApproved: false/);
  assert.match(code, /activated: false/);
  assert.doesNotMatch(code, /tx\.priceListItem\.update/);
  assert.doesNotMatch(code, /tx\.invoiceLine\.update/);
  assert.doesNotMatch(code, /tx\.priceListPackageItem\.update/);
});

test("Stage 126: package tariff draft binds one Access fingerprint with CAS and cannot activate", () => {
  const code = readFileSync(
    "src/app/api/catalog/legacy-row-lineage/package-tariff-draft/route.ts", "utf8");
  const ui = readFileSync("src/components/legacy-row-lineage-review.tsx", "utf8");
  assert.match(code, /withScopedCompositeCreation/);
  assert.match(code, /requirePermission\("pricing\.manage"\)/);
  assert.match(code, /createdByUserId: session\.user\.id/);
  assert.match(code, /sourceTable: "price"/);
  assert.match(code, /classification: "UNRESOLVED"/);
  assert.match(code, /clinicalImportTestWhere/);
  assert.match(code, /items: \{ some: \{\}, every:/);
  assert.match(code, /package_price_window_collision/);
  assert.match(code, /new Prisma\.Decimal\(proposed\.unitPrice\)/);
  assert.match(code, /status: "INACTIVE", deactivatedAt: new Date\(\)/);
  assert.match(code, /tx\.legacyCatalogRowLineage\.updateMany/);
  assert.match(code, /legacy_lineage_claim_conflict/);
  assert.match(code, /independentMappingReviewRequired: true/);
  assert.match(code, /financialApproved: false/);
  assert.match(code, /activated: false/);
  assert.match(ui, /Create inactive package tariff draft/);
  assert.match(ui, /إنشاء مسودة غير نشطة لسعر باقة/);
  assert.doesNotMatch(code, /tx\.(priceListPackageItem|priceListItem)\.update\(/);
  assert.doesNotMatch(code, /tx\.invoiceLine\.(create|update|delete)/);
});
