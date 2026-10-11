import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { publishedHistoryEvidence, resultMatchesPublishedHistory, publishedNumericValue } from "../src/lib/patient-history-published.ts";

const value=()=>({
  componentId:"comp-1",componentCode:"HB",componentNameEn:"Hemoglobin",
  componentNameAr:null,displayValue:"13.5",unit:"g/dL",flag:"NORMAL",
  isCritical:false,referenceLow:"12",referenceHigh:"16",
  referenceTextEn:null,referenceTextAr:null,
});
const row=()=>({
  id:"result-1",orderItemId:"item-1",version:2,
  performingBranchId:"branch-1",methodId:"method-1",analyzerCodeSnapshot:"AN-1",
  orderItem:{testId:"test-1",order:{id:"order-1"}},
  values:[{
    componentId:"comp-1",componentCodeSnapshot:"HB",
    reportNameEnSnapshot:null,componentNameEnSnapshot:"Hemoglobin",
    reportNameArSnapshot:null,componentNameArSnapshot:null,
    displayValue:"13.5",unitSnapshot:"g/dL",flag:"NORMAL",isCritical:false,
    referenceLowSnapshot:{toString:()=>"12"},
    referenceHighSnapshot:{toString:()=>"16"},
    referenceTextEnSnapshot:null,referenceTextArSnapshot:null,
  }],
});
const report=()=>({
  orderId:"order-1",currentVersion:3,versions:[{
    version:3,status:"AMENDED",resultVersionSnapshot:[{
      resultId:"result-1",orderItemId:"item-1",resultVersion:2,
    }],
    contentSnapshot:{order:{id:"order-1"},results:[{
      resultId:"result-1",orderItemId:"item-1",resultVersion:2,
      testId:"test-1",performingBranch:{id:"branch-1"},
      methodId:"method-1",analyzer:{code:"AN-1"},values:[value()],
    }]},
  }],
});

test("Stage 72: only exact released values with immutable published range, flags and provenance are visible",()=>{
  const reports=[report()];
  const evidence=publishedHistoryEvidence(reports);
  assert.equal(resultMatchesPublishedHistory(row(),evidence),true);
  assert.equal(resultMatchesPublishedHistory({...row(),methodId:"different"},evidence),false);
  assert.equal(resultMatchesPublishedHistory({...row(),performingBranchId:"other"},evidence),false);
  assert.equal(resultMatchesPublishedHistory({...row(),orderItem:{testId:"different",order:{id:"order-1"}}},evidence),false);
  for(const key of ["displayValue","unitSnapshot","flag","referenceLowSnapshot","referenceHighSnapshot","isCritical"] as const){
    const altered=row();
    (altered.values[0] as Record<string,unknown>)[key]=key==="isCritical"?true:"corrupted";
    assert.equal(resultMatchesPublishedHistory(altered,evidence),false,key);
  }
  assert.equal(resultMatchesPublishedHistory({...row(),values:[]},evidence),false);
});

test("Stage 72: retracted, mismatched, duplicate or malformed frozen report observations fail closed",()=>{
  const withdrawn=report();
  withdrawn.versions[0].status="RETRACTED";
  assert.equal(publishedHistoryEvidence([withdrawn]).size,0);
  const wrongOrder=report();
  wrongOrder.versions[0].contentSnapshot.order.id="foreign";
  assert.equal(publishedHistoryEvidence([wrongOrder]).size,0);
  const missing=report();
  missing.versions[0].contentSnapshot.results[0].values=[];
  assert.equal(resultMatchesPublishedHistory(row(),publishedHistoryEvidence([missing])),false);
  const duplicate=report();
  duplicate.versions[0].contentSnapshot.results.push({...duplicate.versions[0].contentSnapshot.results[0]});
  assert.equal(publishedHistoryEvidence([duplicate]).size,0);
  const badPointer=report();
  badPointer.versions[0].resultVersionSnapshot[0].resultVersion=1;
  assert.equal(publishedHistoryEvidence([badPointer]).size,0);
});

test("Stage 72: charts only use published plain numeric values, never source hidden precision or qualifiers",()=>{
  assert.equal(publishedNumericValue("13.50",true),"13.50");
  assert.equal(publishedNumericValue("13.50",false),null);
  assert.equal(publishedNumericValue("<5.0",true),null);
  assert.equal(publishedNumericValue("1,200",true),null);
  assert.equal(publishedNumericValue("Positive",true),null);
  assert.equal(publishedNumericValue("Infinity",true),null);
});

test("Stage 72: patient page includes published snapshot gate before chart and cumulative mapping",()=>{
  const source=readFileSync("src/app/patients/[id]/history/page.tsx","utf8");
  assert.match(source,/contentSnapshot: true/);
  assert.match(source,/publishedHistoryEvidence\(trendWindow\.chartEvidence\)/);
  assert.match(source,/resultMatchesCurrentReportPointer\(result, currentResultPointers\)/);
  assert.match(source,/resultMatchesPublishedHistory\(result, publishedEvidence\)/);
  assert.match(source,/publishedNumericValue\(value.displayValue, value.valueNumeric !== null\)/);
  assert.ok(source.indexOf("resultMatchesPublishedHistory(result")<source.indexOf("const trendInputs: TrendPointInput[]"));
});
