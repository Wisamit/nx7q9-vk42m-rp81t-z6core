export type ComponentCandidate = {
  testCode: string;
  code: string;
  nameEn: string;
  unitCode: string;
  resultType: string;
};

export type ComponentMasterIndex = {
  tests: ReadonlyMap<string, { id: string; status: string }>;
  units: ReadonlyMap<string, { id: string; status: string }>;
  components: ReadonlySet<string>;
};

export type ComponentReconciliation = {
  disposition: "READY_FOR_GOVERNANCE" | "BLOCKED";
  issues: string[];
  resolvedTestId: string | null;
  resolvedUnitId: string | null;
};

const supportedResultTypes = new Set(["NUMERIC", "TEXT", "QUALITATIVE", "DATE", "BOOLEAN"]);

export function reconcileComponentCandidate(
  candidate: ComponentCandidate,
  masters: ComponentMasterIndex,
  duplicateCount: number,
): ComponentReconciliation {
  const issues: string[] = [];
  const testCode = candidate.testCode.toUpperCase().trim();
  const componentCode = candidate.code.toUpperCase().trim();
  const unitCode = candidate.unitCode.toUpperCase().trim();
  const test = masters.tests.get(testCode);
  const unit = unitCode ? masters.units.get(unitCode) : null;
  if (!testCode || !componentCode || !candidate.nameEn.trim()) issues.push("MISSING_COMPONENT_IDENTITY");
  if (!test || test.status !== "ACTIVE") issues.push("PARENT_TEST_NOT_ACTIVE_OR_MISSING");
  if (unitCode && (!unit || unit.status !== "ACTIVE")) issues.push("UNIT_NOT_ACTIVE_OR_MISSING");
  if (!supportedResultTypes.has(candidate.resultType)) issues.push("RESULT_TYPE_NEEDS_EXPLICIT_MAPPING");
  if (test && masters.components.has(test.id + "|" + componentCode)) issues.push("COMPONENT_CODE_ALREADY_EXISTS");
  if (duplicateCount > 1) issues.push("DUPLICATE_COMPONENT_IN_BATCH");

  return {
    disposition: issues.length ? "BLOCKED" : "READY_FOR_GOVERNANCE",
    issues,
    resolvedTestId: test?.id || null,
    resolvedUnitId: unit?.id || null,
  };
}
