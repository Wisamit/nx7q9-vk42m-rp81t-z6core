import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("Stage 77: issued report evidence and clinical values are queried in the SAME RepeatableRead transaction", () => {
  const page = readFileSync("src/app/patients/[id]/history/page.tsx", "utf8");
  const begin = page.indexOf("const { trendWindow, resultPage, pageResultPointers, currentResultPointers,");
  const finish = page.indexOf('}, { isolationLevel: "RepeatableRead", timeout: 20000 });',begin);
  assert.ok(begin >= 0 && finish > begin, "clinical results transaction must be present");
  const body = page.slice(begin,finish);
  assert.match(body,/await prisma\.\$transaction\(async tx => \{/);
  assert.match(body,/await tx\.diagnosticReport\.findMany\(/);
  assert.match(body,/await tx\.laboratoryResult\.findMany\(/);
  assert.doesNotMatch(body,/await prisma\.diagnosticReport\.findMany\(/);
  assert.doesNotMatch(body,/await prisma\.laboratoryResult\.findMany\(/);
  assert.ok(body.indexOf("await tx.diagnosticReport.findMany(") <
    body.indexOf("await tx.laboratoryResult.findMany("));
  assert.ok(body.indexOf("currentReportResultPointers(trendWindow.chartEvidence)") <
    body.indexOf("await tx.laboratoryResult.findMany("));
  assert.match(body,/publishedHistoryEvidence\(trendWindow\.chartEvidence\)/);
  assert.match(body,/id: \{ in: \[\.\.\.currentResultIds\] \}/);
  assert.match(body,/return \{ trendWindow, resultPage, pageResultPointers, currentResultPointers,/);
});

test("Stage 77: transaction preserves all clinical branch/tenant and historical published-value rules",()=>{
  const page=readFileSync("src/app/patients/[id]/history/page.tsx","utf8");
  const begin=page.indexOf("const { trendWindow, resultPage, pageResultPointers");
  const finish=page.indexOf('}, { isolationLevel: "RepeatableRead", timeout: 20000 });',begin);
  const tx=page.slice(begin,finish);
  assert.match(tx,/organizationId: session\.user\.organizationId/);
  assert.match(tx,/patientId: \{ in: patientIds \}/);
  assert.match(tx,/performingBranchId: \{ in: branchIds \}/);
  assert.match(tx,/reportVisibleSnapshot: \{ not: false \}/);
  assert.match(tx,/resultVersionSnapshot: true, contentSnapshot: true/);
  assert.match(page,/resultMatchesPublishedHistory\(result, publishedEvidence\)/);
  assert.match(page,/resultMatchesCurrentReportPointer\(result, pageResultPointers\)/);
  assert.match(page,/const cumulativeRows = clinicalResults\.flatMap/);
  assert.match(page,/const trendInputs: TrendPointInput\[\] = verifiedTrendResults\.flatMap/);
  assert.match(page,/const lineage = await prisma\.\$transaction\(/);
  assert.match(page,/tx => resolvePatientLineage\(tx, session\.user\.organizationId, id\)/);
});
