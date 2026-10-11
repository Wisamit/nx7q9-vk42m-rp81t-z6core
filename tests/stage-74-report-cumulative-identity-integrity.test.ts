import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  compareCurrentReportWithPrevious,
  extractCurrentReportReadings,
  type ReportComparisonEvidence,
} from "../src/lib/report-cumulative.ts";

const make = (id: string, patientId = "PAT-A"): ReportComparisonEvidence => ({
  currentVersion: 2,
  order: { id, patientId, accessionNumber: "ACC-" + id, orderedAt: new Date("2026-10-10T09:00:00Z") },
  versions: [{
    version: 2, status: "AMENDED", issuedAt: new Date("2026-10-10T11:00:00Z"),
    resultVersionSnapshot: [{ resultId: "R-" + id, orderItemId: "ITEM-" + id, resultVersion: 3 }],
    contentSnapshot: {
      order: { id, accessionNumber: "ACC-" + id },
      patient: { id: patientId },
      results: [{
        resultId: "R-" + id, orderItemId: "ITEM-" + id, resultVersion: 3,
        testId: "TEST", testCode: "GLU", testNameEn: "Glucose", methodId: "M",
        analyzer: { code: "A" }, performingBranch: { id: "BR" },
        values: [{ componentId: "C", componentCode: "GLU", componentNameEn: "Glucose",
          displayValue: "96", flag: "NORMAL", unit: "mg/dL",
          referenceLow: "70", referenceHigh: "100", referenceTextEn: "70-100" }],
      }],
    },
  }],
});
const mutate = (report: ReportComparisonEvidence, action: (snapshot: Record<string, unknown>)=>void) => {
  const cloned = structuredClone(report);
  action(cloned.versions[0].contentSnapshot as Record<string, unknown>);
  return cloned;
};

test("Stage 74: exact frozen order, accession and original patient identity are required", () => {
  const base = make("ORDER-1");
  assert.equal(extractCurrentReportReadings(base,["BR"]).length,1);
  for(const field of ["id","accessionNumber"] as const) {
    const corrupted = mutate(base,s => { (s.order as Record<string,unknown>)[field]="SWAPPED"; });
    assert.deepEqual(extractCurrentReportReadings(corrupted,["BR"]),[],field);
  }
  assert.deepEqual(extractCurrentReportReadings(mutate(base,s => {
    (s.patient as Record<string,unknown>).id="DIFFERENT-PATIENT";
  }),["BR"]),[]);
  assert.deepEqual(extractCurrentReportReadings(mutate(base,s => { delete s.patient; }),["BR"]),[]);
  assert.deepEqual(extractCurrentReportReadings(mutate(base,s => { delete s.order; }),["BR"]),[]);
  assert.deepEqual(extractCurrentReportReadings(base,["OTHER-BRANCH"]),[]);
});

test("Stage 74: merged-alias historical patient is valid only when that order's own frozen patient matches",()=>{
  const alias = make("LEGACY","PAT-OLD");
  assert.equal(extractCurrentReportReadings(alias,["BR"]).length,1);
  const reassignedOrder={...alias,order:{...alias.order,patientId:"PAT-CANONICAL"}};
  assert.equal(extractCurrentReportReadings(reassignedOrder,["BR"]).length,0);
});

test("Stage 74: disputed revision pointers, duplicate result identities and component codes fail closed",()=>{
  const base=make("ORDER-1");
  const conflict=structuredClone(base);
  (conflict.versions[0].resultVersionSnapshot as Array<Record<string,unknown>>)
    .push({resultId:"R-ORDER-1",orderItemId:"ANOTHER-ITEM",resultVersion:3});
  assert.deepEqual(extractCurrentReportReadings(conflict,["BR"]),[]);
  const wrongRevision=structuredClone(base);
  (wrongRevision.versions[0].resultVersionSnapshot as Array<Record<string,unknown>>)[0].resultVersion=2;
  assert.deepEqual(extractCurrentReportReadings(wrongRevision,["BR"]),[]);
  assert.deepEqual(extractCurrentReportReadings(mutate(base,s=>{
    (s.results as unknown[]).push(structuredClone((s.results as unknown[])[0]));
  }),["BR"]),[]);
  assert.deepEqual(extractCurrentReportReadings(mutate(base,s=>{
    const v=((s.results as Record<string,unknown>[])[0].values as Record<string,unknown>[]);
    v.push({...v[0],displayValue:"CORRUPT"});
  }),["BR"]),[]);
});

test("Stage 74: mismatched newer report cannot replace an older clinically comparable reading",()=>{
  const current=make("CURRENT");
  current.order.orderedAt=new Date("2026-10-10T09:00:00Z");
  const previous=make("OLD");
  previous.order.orderedAt=new Date("2026-09-01T09:00:00Z");
  previous.versions[0].issuedAt=new Date("2026-09-01T11:00:00Z");
  const latest=make("WRONG-PATIENT");
  latest.order.orderedAt=new Date("2026-10-01T09:00:00Z");
  latest.versions[0].issuedAt=new Date("2026-10-01T11:00:00Z");
  const corrupt=mutate(latest,s=>{
    (s.patient as Record<string,unknown>).id="UNKNOWN";
  });
  const result=compareCurrentReportWithPrevious(current,[previous,corrupt],["BR"]);
  assert.equal(result.length,1);
  assert.equal(result[0].previous?.orderId,"OLD");
  assert.equal(result[0].reason,"MATCH");
  assert.equal(result[0].previous?.referenceTextEn,"70-100");
  assert.deepEqual(compareCurrentReportWithPrevious(mutate(current,s=>{
    (s.order as Record<string,unknown>).id="DIFFERENT-ORDER";
  }),[previous],["BR"]),[]);
});

test("Stage 74: report route sends exact patient identity and preserves no-print clinical provenance boundary",()=>{
  const page=readFileSync("src/app/reports/[orderId]/page.tsx","utf8");
  const helper=readFileSync("src/lib/report-cumulative.ts","utf8");
  assert.match(page,/patientId: true, accessionNumber: true/);
  assert.match(page,/patientId: report.order.patientId/);
  assert.match(helper,/snapshot.patient.id !== report.order.patientId/);
  assert.match(helper,/snapshot.order.accessionNumber !== report.order.accessionNumber/);
  assert.match(helper,/currentReportResultPointers/);
  assert.ok(page.indexOf("</article>")<page.indexOf("<ReportCumulativeComparison"));
});
