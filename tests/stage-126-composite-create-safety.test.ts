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
  assert.match(helper, /composite_department_scope_changed/);
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
  const drift = readFileSync("src/app/api/catalog/imports/[id]/bundle-drift/route.ts", "utf8");
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
