import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { reconcileComponentCandidate } from "../src/lib/component-import-reconciliation.ts";

const valid = { testCode: "T1", code: "C1", nameEn: "Analyte", unitCode: "MG", resultType: "NUMERIC" };
const index = {
  tests: new Map([["T1", { id: "TEST1", status: "ACTIVE" }]]),
  units: new Map([["MG", { id: "UNIT1", status: "ACTIVE" }]]),
  components: new Set<string>(),
};

test("component staging mapping can be ready for governance but never clinical import", () => {
  assert.deepEqual(reconcileComponentCandidate(valid, index, 1), {
    disposition: "READY_FOR_GOVERNANCE",
    issues: [], resolvedTestId: "TEST1", resolvedUnitId: "UNIT1",
  });
});

test("unknown/inactive test, unit, result type, duplicate identity fail closed", () => {
  const cases = [
    [{ ...valid, testCode: "UNKNOWN" }, "PARENT_TEST_NOT_ACTIVE_OR_MISSING"],
    [{ ...valid, unitCode: "UNKNOWN" }, "UNIT_NOT_ACTIVE_OR_MISSING"],
    [{ ...valid, resultType: "FLOAT" }, "RESULT_TYPE_NEEDS_EXPLICIT_MAPPING"],
    [{ ...valid, code: "" }, "MISSING_COMPONENT_IDENTITY"],
  ] as const;
  for (const [candidate, issue] of cases) {
    const assessment = reconcileComponentCandidate(candidate, index, 1);
    assert.equal(assessment.disposition, "BLOCKED");
    assert.ok(assessment.issues.includes(issue));
  }
  assert.ok(reconcileComponentCandidate(valid, index, 2).issues.includes("DUPLICATE_COMPONENT_IN_BATCH"));
  const existing = { ...index, components: new Set(["TEST1|C1"]) };
  assert.ok(reconcileComponentCandidate(valid, existing, 1).issues.includes("COMPONENT_CODE_ALREADY_EXISTS"));
  const inactive = { ...index, tests: new Map([["T1", { id: "TEST1", status: "INACTIVE" }]]) };
  assert.ok(reconcileComponentCandidate(valid, inactive, 1).issues.includes("PARENT_TEST_NOT_ACTIVE_OR_MISSING"));
});

test("read-only reconciliation route filters tenant, avoids imported writes and has bounded page with stable cursor", () => {
  const source = readFileSync(new URL("../src/app/api/catalog/imports/[id]/components/reconcile/route.ts", import.meta.url), "utf8");
  assert.ok(source.includes('requirePermission("catalog.manage")'));
  assert.ok(source.includes("organizationId: session.user.organizationId"));
  assert.ok(source.includes('entityType: "COMPONENT"'));
  assert.ok(source.includes('rowNumber: { gt: after }'));
  assert.ok(source.includes("take: PAGE_SIZE + 1"));
  assert.ok(source.includes("liveWrites: false"));
  assert.ok(source.includes("approvalRequired: true"));
  assert.ok(source.includes("Cache-Control"));
  assert.ok(!source.includes("testComponent.create("));
  assert.ok(!source.includes("testComponent.update("));
  assert.ok(!source.includes("catalogImportRow.update("));
  const commit = readFileSync(new URL("../src/app/api/catalog/imports/[id]/commit/route.ts", import.meta.url), "utf8");
  assert.ok(commit.includes('["UNIT", "CONTAINER", "TEST", "PANEL"]'));
  assert.ok(commit.includes('["REFERENCE_INTERVAL", "COMPONENT", "PRICE_LIST_ITEM"]'));
});

test("review UI describes informational/non-approval semantics in both languages", () => {
  const s = readFileSync(new URL("../src/components/component-import-reconciliation.tsx", import.meta.url), "utf8");
  assert.ok(s.includes("NOT approved for live import"));
  assert.ok(s.includes("وليست موافقة على الاستيراد الفعلي"));
  assert.ok(s.includes("Next 100 rows"));
  assert.ok(s.includes("الـ100 صف التالية"));
});
