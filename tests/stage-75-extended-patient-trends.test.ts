import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  allowExtendedTrend,
  clinicalTrendWindow,
  EXTENDED_TREND_REPORT_LIMIT,
} from "../src/lib/patient-history-trend-window.ts";
import {
  currentReportResultPointers,
  buildPatientTrendSeries,
} from "../src/lib/patient-history.ts";
import { publishedNumericValue } from "../src/lib/patient-history-published.ts";

test("Stage 75: wider clinical discovery requires authorized results on page one",()=>{
  assert.equal(allowExtendedTrend("extended","results",1,true),true);
  for(const [mode,section,page,permission] of [
    ["extended","finance",1,true], ["extended","orders",1,true],
    ["extended","results",2,true],["extended","results",1,false],
    ["anything","results",1,true], [undefined,"results",1,true],
  ] as const){
    assert.equal(allowExtendedTrend(mode,section,page,permission),false);
  }
});

test("Stage 75: ordinary results remain paged; expanded chart scans a bounded independent window",()=>{
  const rows=Array.from({length:300},(_,i)=>({index:i}));
  const regular=clinicalTrendWindow(rows.slice(0,21),false);
  assert.deepEqual(regular.page.rows.map(r=>r.index),Array.from({length:20},(_,i)=>i));
  assert.equal(regular.page.hasNext,true);
  assert.equal(regular.chartEvidence.length,20);
  assert.equal(regular.truncated,false);
  const extended=clinicalTrendWindow(rows.slice(0,EXTENDED_TREND_REPORT_LIMIT+1),true);
  assert.equal(extended.page.rows.length,20);
  assert.equal(extended.page.hasNext,true);
  assert.equal(extended.chartEvidence.length,250);
  assert.equal(extended.chartEvidence[249].index,249);
  assert.equal(extended.truncated,true);
  const complete=clinicalTrendWindow(rows.slice(0,24),true);
  assert.equal(complete.chartEvidence.length,24);
  assert.equal(complete.truncated,false);
});

test("Stage 75: current report pointer still revokes withdrawn results in extended evidence",()=>{
  const reports=Array.from({length:24},(_,i)=>({
    orderId:"ORDER-"+i,currentVersion:1,
    versions:[{
      version:1,status:i===2?"RETRACTED":"FINAL",
      resultVersionSnapshot:[{orderItemId:"ITEM-"+i,resultId:"RESULT-"+i,resultVersion:1}],
    }],
  }));
  const wide=clinicalTrendWindow(reports,true);
  const regular=clinicalTrendWindow(reports.slice(0,21),false);
  assert.equal(currentReportResultPointers(wide.chartEvidence).size,23);
  assert.equal(currentReportResultPointers(regular.chartEvidence).size,19);
  assert.equal(currentReportResultPointers(wide.chartEvidence).has("RESULT-23"),true);
  assert.equal(currentReportResultPointers(regular.chartEvidence).has("RESULT-23"),false);
  const printed=publishedNumericValue("13.50",true);
  assert.equal(printed,"13.50");
  assert.equal(publishedNumericValue(">13.5",true),null);
  const series=buildPatientTrendSeries(["13.50","14.20"].map((value,i)=>({
    testId:"TEST",testCode:"HB",testNameEn:"Hemoglobin",testNameAr:null,
    componentId:"COMPONENT",componentCode:"HB",componentNameEn:"Hemoglobin",componentNameAr:null,
    unit:"g/dL",methodId:"METHOD",analyzerCode:"ANA",valueNumeric:value,displayValue:value,
    flag:"NORMAL",observedAt:new Date(2026,1,i+1).toISOString(),
    accessionNumber:"ACC-"+i,orderId:"ORDER-"+i,resultVersion:1,
  })));
  assert.equal(series.length,1);
  assert.equal(series[0].points.length,2);
});

test("Stage 75: route binds each result to live released-snapshot evidence before both displays",()=>{
  const page=readFileSync("src/app/patients/[id]/history/page.tsx","utf8");
  assert.match(page,/allowExtendedTrend\(query\.trend, section, navigation\.page, canViewReports\)/);
  assert.match(page,/take: expandedTrend \? EXTENDED_TREND_REPORT_LIMIT \+ 1 : navigation.take/);
  assert.match(page,/publishedHistoryEvidence\(trendWindow\.chartEvidence\)/);
  assert.match(page,/resultMatchesPublishedHistory\(result, publishedEvidence\)/);
  assert.match(page,/resultMatchesCurrentReportPointer\(result, pageResultPointers\)/);
  assert.match(page,/verifiedTrendResults\.flatMap/);
  assert.match(page,/const cumulativeRows = clinicalResults\.flatMap/);
  assert.match(page,/performingBranchId: \{ in: branchIds \}/);
  assert.match(page,/patientId: \{ in: patientIds \}/);
  assert.match(page,/test: \{ departmentId: \{ in: departmentIds \} \}/);
  assert.match(page,/This is NOT the patient's complete trend/);
});
