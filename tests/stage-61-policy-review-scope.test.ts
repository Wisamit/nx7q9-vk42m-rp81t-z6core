import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { policyReviewIdentityScope } from "../src/lib/catalog-policy-review-scope.ts";

const testId = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const unitId = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";
const componentId = "cccccccc-cccc-4ccc-cccc-cccccccccccc";
const branchId = "dddddddd-dddd-4ddd-dddd-dddddddddddd";
const item = (entityType: string, id: string, values: Record<string, unknown> = {}) => ({
  entityType, sourceData: entityType === "PRICE_LIST"
    ? {id,code:"S61",currency:"AED",status:"ACTIVE",...values}
    : {id},
  normalizedData: { id, ...values },
  status: "WARNING", importedEntityId: null,
});
const records = [
  item("TEST", testId), item("UNIT", unitId),
  item("COMPONENT", componentId, {testId, unitId}),
  item("REFERENCE_INTERVAL", "eeeeeeee-eeee-4eee-eeee-eeeeeeeeeeee", {componentId,branchId}),
];

test("Stage 61: all staged identities and parent references are scoped, without values", () => {
  const result = policyReviewIdentityScope(records, new Set([branchId]));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.refs.tests.has(testId), true);
  assert.equal(result.refs.units.has(unitId), true);
  assert.equal(result.refs.components.has(componentId), true);
  assert.deepEqual(result.ids.get("REFERENCE_INTERVAL"), ["eeeeeeee-eeee-4eee-eeee-eeeeeeeeeeee"]);
  assert.equal("sourceData" in result, false);
  assert.equal("normalizedData" in result, false);
});

test("Stage 61: stale branch scope, conflicting identities, malformed source and invalid price scope fail closed", () => {
  assert.deepEqual(policyReviewIdentityScope(records, new Set()), {
    ok: false, error: "policy_review_batch_scope_changed",
  });
  assert.equal(policyReviewIdentityScope([...records, records[0]], new Set([branchId])).ok, false);
  assert.equal(policyReviewIdentityScope([item("UNKNOWN", testId)], new Set([branchId])).ok, false);
  assert.equal(policyReviewIdentityScope([{...records[0], sourceData: {id: unitId}}], new Set([branchId])).ok, false);
  assert.equal(policyReviewIdentityScope([item("PRICE_LIST", unitId, {
    scopeType: "CLIENT", branchId: null,
  })], new Set([branchId])).ok, false);
  assert.equal(policyReviewIdentityScope([item("PRICE_LIST", unitId, {
    scopeType: "BRANCH", branchId: null,
  })], new Set([branchId])).ok, false);
  assert.equal(policyReviewIdentityScope([item("COMPONENT", componentId, {
    testId: "not-uuid",
  })], new Set([branchId])).ok, false);
  assert.equal(policyReviewIdentityScope([{...records[0], status: "APPLIED"}], new Set([branchId])).ok, false);
  assert.equal(policyReviewIdentityScope([{...records[0], importedEntityId: testId}], new Set([branchId])).ok, false);
  assert.equal(policyReviewIdentityScope([], new Set([branchId])).ok, false);
  assert.equal(policyReviewIdentityScope(Array(5001).fill(records[0]), new Set([branchId])).ok, false);
});

test("Stage 61: full-batch live master checks run at GET and POST commit, no master mutations", () => {
  const route = readFileSync("src/app/api/catalog/imports/[id]/policy-review/route.ts", "utf8");
  const scope = readFileSync("src/lib/catalog-policy-review-scope.ts", "utf8");
  assert.match(route, /validatePolicyReviewBatchScope\(tx/);
  assert.match(route, /const batchScope = await validatePolicyReviewBatchScope/);
  assert.match(route, /if \(!batchScope.ok\)/);
  assert.match(route, /SELECT id FROM organizations WHERE id = \$\{organizationId\}/);
  assert.match(route, /isolationLevel: "RepeatableRead"/);
  assert.match(scope, /BUNDLE_REVIEW_MAX_ROWS \+ 1/);
  for (const model of ["labTest","unit","testComponent","priceList",
    "referenceInterval","priceListItem"]) {
    assert.match(scope, new RegExp("tx\\." + model + "\\.count\\("));
  }
  assert.doesNotMatch(route + scope,
    /tx\.(?:labTest|unit|testComponent|priceList|priceListItem|referenceInterval)\.(?:create|update|upsert|delete)/);
});
