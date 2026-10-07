export type AnalyzerRouteCandidate = {
  analyzerId: string;
  analyzerBranchId: string;
  analyzerDepartmentId: string | null;
  mappedTestIds: string[];
};

export function analyzerCanRouteWorkItem(
  candidate: AnalyzerRouteCandidate,
  context: {
    testId: string;
    testDepartmentId: string | null;
    readySpecimenBranchIds: string[];
  },
) {
  if (!context.readySpecimenBranchIds.includes(candidate.analyzerBranchId)) return false;
  if (
    candidate.analyzerDepartmentId &&
    context.testDepartmentId &&
    candidate.analyzerDepartmentId !== context.testDepartmentId
  ) return false;
  return candidate.mappedTestIds.includes(context.testId);
}

export function analyzerRoutingAllowsImport(activeAnalyzerIds: string[], incomingAnalyzerId: string) {
  return activeAnalyzerIds.length === 0 || activeAnalyzerIds.includes(incomingAnalyzerId);
}
