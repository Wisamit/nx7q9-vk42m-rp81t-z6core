import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  currentReportResultPointers, resultMatchesCurrentReportPointer,
  latestClinicalResultIds, buildPatientTrendSeries,
} from "../src/lib/patient-history.ts";

const ptr=(id:string,item:string,version:number)=>({
  resultId:id,orderItemId:item,resultVersion:version,
});
const report=(orderId:string, status:string,version:number, snapshots:unknown,
  currentVersion=version)=>({
  orderId,currentVersion,versions:[{
    version,status,resultVersionSnapshot:snapshots,
  }],
});
const result=(id:string,orderItemId:string,version:number,orderId:string)=>({
  id,orderItemId,version,orderItem:{order:{id:orderId}},
  status:"RELEASED",releasedAt:new Date("2026-10-01T10:00:00.000Z"),
});

test("Stage 71: current released report snapshots attest exact order, item and immutable result revision",()=>{
  const evidence=currentReportResultPointers([
    report("order-1","FINAL",3,[ptr("R1","item-1",2)]),
  ]);
  assert.deepEqual(evidence.get("R1"),{
    orderId:"order-1",orderItemId:"item-1",resultVersion:2,
  });
  assert.equal(resultMatchesCurrentReportPointer(
    result("R1","item-1",2,"order-1"),evidence),true);
  assert.equal(resultMatchesCurrentReportPointer(
    result("R1","item-1",1,"order-1"),evidence),false);
  assert.equal(resultMatchesCurrentReportPointer(
    result("R1","other-item",2,"order-1"),evidence),false);
  assert.equal(resultMatchesCurrentReportPointer(
    result("R1","item-1",2,"other-order"),evidence),false);
  assert.equal(resultMatchesCurrentReportPointer(
    result("other-result","item-1",2,"order-1"),evidence),false);
});

test("Stage 71: withdrawn, stale, non-current and malformed report pointers never expose clinical readings",()=>{
  const resultPointers=currentReportResultPointers([
    report("O1","RETRACTED",2,[ptr("retracted","I",1)]),
    report("O2","AMENDED",3,[ptr("stale","I",1)],4),
    report("O3","DRAFT",1,[ptr("draft","I",1)]),
    report("O4","FINAL",3,[ptr("ok","I",3),ptr("bad","I","2" as unknown as number),null,
      {resultId:"without-item",resultVersion:1}]),
    report("","FINAL",1,[ptr("missing-order","I",1)]),
  ]);
  assert.deepEqual([...resultPointers.keys()],["ok"]);
  assert.equal(resultMatchesCurrentReportPointer(result("ok","I",3,"O4"),resultPointers),true);
});

test("Stage 71: conflicting duplicate result IDs across reports are quarantined, identical evidence is idempotent",()=>{
  const pointers=currentReportResultPointers([
    report("O1","FINAL",1,[ptr("R1","I1",1),ptr("R2","I2",1),ptr("R1","I1",1)]),
    report("O2","FINAL",1,[ptr("R1","I1",1)]),
    report("O3","AMENDED",2,[ptr("R2","I2",2)]),
    report("O1","AMENDED",3,[ptr("R1","I1",1)]),
  ]);
  assert.deepEqual([...pointers.keys()],[]);
});

test("Stage 71: invalid snapshot pointers cannot enter the released trend selection",()=>{
  const evidence=currentReportResultPointers([
    report("O1","FINAL",1,[ptr("R1","I1",2)]),
  ]);
  const candidates=[
    result("R1","I1",1,"O1"),
    result("R1","I1",2,"O1"),
    result("R2","I1",3,"O1"),
  ];
  const valid=candidates.filter(x=>resultMatchesCurrentReportPointer(x,evidence));
  assert.deepEqual(valid.map(x=>x.version),[2]);
  assert.deepEqual([...latestClinicalResultIds(valid)],["I1:2"]);
  const trends=buildPatientTrendSeries(valid.map(x=>({
    testId:"T",testCode:"GLU",testNameEn:"Glucose",testNameAr:null,
    componentId:"C",componentCode:"GLU",componentNameEn:"Glucose",componentNameAr:null,
    unit:"mg/dL",valueNumeric:"95",displayValue:"95",flag:"NORMAL",
    methodId:"M",analyzerCode:"A",observedAt:"2026-10-01T10:00:00.000Z",
    accessionNumber:"A1",orderId:x.orderItem.order.id,resultVersion:x.version,
  })));
  assert.equal(trends.length,1);
  assert.equal(trends[0].points[0].resultVersion,2);
});

test("Stage 71: patient history page enforces pointers before trend/cumulative disclosure",()=>{
  const page=readFileSync("src/app/patients/[id]/history/page.tsx","utf8");
  assert.match(page,/organizationId: true,\s*orderId: true/);
  assert.match(page,/order: \{\s*select: \{ id: true, patientId: true, accessionNumber: true, orderingBranchId: true \}/);
  assert.match(page,/currentVersion: true/);
  assert.match(page,/currentReportResultPointers\(releaseEvidence\)/);
  assert.match(page,/new Set\(currentResultPointers\.keys\(\)\)/);
  assert.match(page,/resultMatchesCurrentReportPointer\(result, currentResultPointers\)/);
  assert.match(page,/latestClinicalResultIds\(reportMatchedCandidates\)/);
  assert.match(page,/const clinicalResults = verifiedTrendResults\.filter/);
  assert.match(page,/resultMatchesCurrentReportPointer\(result, pageResultPointers\)/);
  assert.ok(page.indexOf("resultMatchesCurrentReportPointer(result") <
    page.indexOf("const trendInputs: TrendPointInput[]"));
  assert.match(page,/performingBranchId: \{ in: branchIds \}/);
  assert.match(page,/patientId: \{ in: patientIds \}/);
  assert.match(page,/where: \{ reportVisibleSnapshot: \{ not: false \} \}/);
  assert.match(page,/Clinical tables and trends reflect ONLY this page/);
});
