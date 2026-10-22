import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { catalogBundleDrift } from "../src/lib/catalog-bundle-drift.ts";

const actualRoute=readFileSync("src/app/api/catalog/imports/[id]/bundle-drift/route.ts","utf8");
const loadCall="const live = await readCatalogLiveObservations(tx,liveScope,branchIds,idsByType);";
assert.ok(actualRoute.includes(loadCall),"author route must invoke canonical full live reader");
const route=actualRoute.replace(loadCall,readFileSync("src/lib/catalog-live-observation.ts","utf8"));
const ui = readFileSync("src/components/catalog-bundle-drift-review.tsx", "utf8");
const page = readFileSync("src/app/catalog/imports/[id]/page.tsx", "utf8");

test("Stage 52: zero drift and exact decimal/clinical string identities", () => {
  const a = { id: "one", status: "ACTIVE", price: "123.4500", range: {
    low: "70.000000", criticalLow: "32.000000", branchId: null,
    effectiveFrom: "2026-10-10T00:00:00.000Z",
  }, extra: [{ unit: "mg/dL", label: "Glucose" }] };
  assert.deepEqual(catalogBundleDrift(a, structuredClone(a)), {
    disposition: "UNCHANGED", changedFields: [], additionalFieldsOmitted: false,
  });
  const changed = { ...a, price: "123.45", range: { ...a.range, criticalLow: "31.000000" } };
  const result = catalogBundleDrift(a, changed);
  assert.equal(result.disposition, "DRIFTED");
  assert.deepEqual(new Set(result.changedFields), new Set(["price", "range.criticalLow"]));
  assert.ok(!JSON.stringify(result).includes("123.4500"));
  assert.ok(!JSON.stringify(result).includes("70.000000"));
});

test("Stage 52: missing, additional, nested and capped changes are never hidden as equal", () => {
  assert.equal(catalogBundleDrift({ price: "100.0000" }, {}).disposition, "DRIFTED");
  assert.equal(catalogBundleDrift({}, { price: "100.0000" }).disposition, "DRIFTED");
  assert.ok(catalogBundleDrift({ paths: ["one", "two"] }, { paths: ["one"] })
    .changedFields.includes("paths.length"));
  const source = Object.fromEntries(Array.from({ length: 45 }, (_, i) => ["col" + i, i]));
  const changed = Object.fromEntries(Array.from({ length: 45 }, (_, i) => ["col" + i, i + 1]));
  const result = catalogBundleDrift(source, changed);
  assert.equal(result.disposition, "DRIFTED");
  assert.equal(result.changedFields.length, 24);
  assert.equal(result.additionalFieldsOmitted, true);
  assert.equal(catalogBundleDrift({ "secret<key>": 1 }, { "secret<key>": 2 })
    .changedFields[0], "(other)");
  assert.throws(() => catalogBundleDrift({}, {}, 0));
});

test("Stage 52: full-batch grants, nine scoped projections, and no clinical or financial mutation", () => {
  const lock = route.indexOf("const orgLock = await tx.$queryRaw");
  const roles = route.indexOf("const activeUser = await tx.user.findFirst");
  const grants = route.indexOf("const branchGrants = await tx.userBranchScope.findMany");
  const rows = route.indexOf("const staged = await tx.catalogImportRow.findMany");
  const scopeTests = route.indexOf("const [mappedTests, mappedUnits, mappedComponents, mappedLists, mappedPackages]");
  const selects = route.indexOf('if (type === "TEST")');
  const audit = route.indexOf('action: "CATALOG_BUNDLE_DRIFT_REVIEWED"');
  assert.ok(lock > 0 && roles > lock && grants > roles && rows > grants &&
    scopeTests > rows && selects > scopeTests && audit > selects);
  assert.match(route, /createdByUserId: session.user.id/);
  assert.match(route, /sourceType: BUNDLE_REVIEW_SOURCE/);
  assert.match(route, /status: "DRAFT"/);
  assert.match(route, /sessionPermissions.has\(code\) && livePermissions.has\(code\)/);
  assert.match(route, /reconciliation_clinical_permission_revoked/);
  assert.match(route, /reconciliation_pricing_permission_revoked/);
  assert.match(route, /initiallyGrantedBranches.has\(id\)/);
  assert.match(route, /initiallyGrantedDepartments.has\(item.departmentId\)/);
  assert.match(route, /restrictedDepartments && !currentDepartments.length/);
  assert.match(route, /clinicalImportTestWhere\(liveScope\)/);
  assert.match(route, /mappedTests !== testRefs.size/);
  assert.match(route, /mappedComponents !== componentRefs.size/);
  assert.match(route, /mappedLists !== priceListRefs.size/);
  assert.match(route, /records.length !== ids.length/);
  assert.match(route, /isolationLevel: "RepeatableRead"/);
  assert.match(route, /scopeType: "ORGANIZATION"/);
  assert.match(route, /scopeType: "BRANCH"/);
  assert.doesNotMatch(route, /scopeType: "CLIENT"/);
  assert.doesNotMatch(route, /scopeType: "CONTRACT"/);
  assert.doesNotMatch(route, /tx\.(?:labTest|testComponent|unit|referenceInterval|priceList|priceListItem|laboratoryResult|labOrder)\.(?:create|update|upsert|delete)/);
  assert.match(route, /liveWrites: false/);
  assert.match(route, /clinicalActivation: false/);
  assert.match(route, /priceActivation: false/);
  assert.match(route, /approvalRequired: true/);
  assert.match(ui, /unexpected_reconciliation_response/);
  assert.match(ui, /Read-only comparison/);
  assert.match(page, /isBundleReview && <CatalogBundleDriftReview/);
});
