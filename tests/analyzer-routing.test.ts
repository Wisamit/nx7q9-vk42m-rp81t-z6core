import test from "node:test";
import assert from "node:assert/strict";
import { analyzerCanRouteWorkItem, analyzerRoutingAllowsImport } from "../src/lib/analyzer-routing.ts";

test("analyzer route requires same specimen branch and mapped test", () => {
  const candidate = {
    analyzerId: "A1",
    analyzerBranchId: "B1",
    analyzerDepartmentId: "D1",
    mappedTestIds: ["T1", "T2"],
  };

  assert.equal(analyzerCanRouteWorkItem(candidate, {
    testId: "T1",
    testDepartmentId: "D1",
    readySpecimenBranchIds: ["B1"],
  }), true);

  assert.equal(analyzerCanRouteWorkItem(candidate, {
    testId: "T1",
    testDepartmentId: "D1",
    readySpecimenBranchIds: ["B2"],
  }), false);

  assert.equal(analyzerCanRouteWorkItem(candidate, {
    testId: "T9",
    testDepartmentId: "D1",
    readySpecimenBranchIds: ["B1"],
  }), false);
});

test("department-scoped analyzer cannot route a different department", () => {
  assert.equal(analyzerCanRouteWorkItem({
    analyzerId: "A1",
    analyzerBranchId: "B1",
    analyzerDepartmentId: "D2",
    mappedTestIds: ["T1"],
  }, {
    testId: "T1",
    testDepartmentId: "D1",
    readySpecimenBranchIds: ["B1"],
  }), false);
});

test("organization-level analyzer department is not required", () => {
  assert.equal(analyzerCanRouteWorkItem({
    analyzerId: "A1",
    analyzerBranchId: "B1",
    analyzerDepartmentId: null,
    mappedTestIds: ["T1"],
  }, {
    testId: "T1",
    testDepartmentId: "D1",
    readySpecimenBranchIds: ["B1"],
  }), true);
});

test("analyzer import is open when no route exists and restricted once routed", () => {
  assert.equal(analyzerRoutingAllowsImport([], "A1"), true);
  assert.equal(analyzerRoutingAllowsImport(["A1", "A2"], "A2"), true);
  assert.equal(analyzerRoutingAllowsImport(["A1", "A2"], "A3"), false);
});
