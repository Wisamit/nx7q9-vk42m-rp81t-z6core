import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { catalogExportTypes } from "../src/lib/catalog-configuration-export.ts";
import { catalogBundleAllowedSourceFields } from "../src/lib/catalog-bundle-source-boundary.ts";
import { f2ReadOnlyBatchReconciliation, type F2ReconciliationRow } from "../src/lib/catalog-f2-batch-reconciliation.ts";

const id=(n:number)=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
function records():F2ReconciliationRow[]{
  return [...catalogExportTypes].map((entityType,index)=>{
    const data:Record<string,unknown>={};
    for(const key of catalogBundleAllowedSourceFields[entityType])data[key]=null;
    data.id=id(index+1);
    if(!["REFERENCE_INTERVAL","PRICE_LIST_ITEM","PRICE_LIST_PACKAGE_ITEM"].includes(entityType))
      data.code="SYNTHETIC-"+index;
    return {
      rowNumber:index+1,entityType,sourceData:data,
      normalizedData:{id:data.id},scopedLiveData:structuredClone(data),
    };
  });
}
const verified=(rows:readonly F2ReconciliationRow[])=>f2ReadOnlyBatchReconciliation({
  rows,wholeStageHmacVerified:true,currentTenClassScopeVerified:true,
  currentLiveSnapshotVerified:true,
});

test("F2: ten-class full-set report is deterministic, read-only, and never approved",()=>{
  const data=records();
  const report=verified(data);
  assert.ok(report);
  assert.equal(report.totalRows,10);
  assert.equal(report.changedRows,0);
  assert.equal(report.unchangedRows,10);
  assert.equal(report.classes.length,10);
  assert.deepEqual(report.classes.map(x=>x.entityType),[...catalogExportTypes]);
  assert.equal(report.state,"TEN_CLASS_EVIDENCE_ONLY");
  assert.equal(report.status,"BLOCKED_EXTERNAL");
  for(const key of ["sourceInstallationProven","approved","clinicalSignoffVerified",
    "financeSignoffVerified","approvedRoundTripVerified","atomicApplyEnabled",
    "correctiveReversalEnabled","liveWrites"] as const)
    assert.equal(report[key],false,key);
  assert.equal(report.reviewOnly,true);
  assert.equal(JSON.stringify(report).includes(id(1)),false,"never expose raw local/source UUID");
  assert.equal(verified([...data].reverse()),null,"row ordinals must follow the sealed source stage");
});

test("F2: normalized source, live and duplicate identity all fail closed",()=>{
  const rows=records();
  assert.equal(verified(rows.slice(0,9)),null,"nine native classes are not a complete ten-class closeout");
  assert.equal(verified(rows.map((row,i)=>i===5?{...row,entityType:"UNKNOWN"}:row)),null);
  assert.equal(verified(rows.map((row,i)=>i===5?{...row,rowNumber:15}:row)),null);
  assert.equal(verified(rows.map((row,i)=>i===5?{...row,
    normalizedData:{id:id(22)},
  }:row)),null);
  assert.equal(verified(rows.map((row,i)=>i===5?{...row,
    scopedLiveData:{...(row.scopedLiveData as object),id:id(22)},
  }:row)),null);
  assert.equal(verified(rows.map((row,i)=>i===5?{...row,
    sourceData:{...(row.sourceData as object),unreviewedField:true},
  }:row)),null);
  assert.equal(verified(rows.map((row,i)=>i===5?{...row,
    scopedLiveData:null,
  }:row)),null);
  const duplicate={...rows[0],rowNumber:11};
  assert.equal(verified([...rows,duplicate]),null,"repeated source/target UUID cannot be another row");
  const alternate=rows.map((row,i)=>i===3?{...row,
    sourceData:{...(row.sourceData as object),id:id(4).toUpperCase()},
  }:row);
  assert.equal(verified(alternate),null,"unapproved UUID normalization is not a mapping policy");
  assert.equal(f2ReadOnlyBatchReconciliation({
    rows,wholeStageHmacVerified:false as true,currentTenClassScopeVerified:true,
    currentLiveSnapshotVerified:true,
  }),null);
  assert.equal(f2ReadOnlyBatchReconciliation({
    rows,wholeStageHmacVerified:true,currentTenClassScopeVerified:false as true,
    currentLiveSnapshotVerified:true,
  }),null);
  assert.equal(f2ReadOnlyBatchReconciliation({
    rows,wholeStageHmacVerified:true,currentTenClassScopeVerified:true,
    currentLiveSnapshotVerified:false as true,
  }),null);
});

test("F2: clinical/finance/composite nested diffs produce field names but never actual values",()=>{
  const rows=records().map(row=>{
    const live={...(row.scopedLiveData as Record<string,unknown>)};
    if(row.entityType==="REFERENCE_INTERVAL")live.criticalLow="17.000001";
    if(row.entityType==="PRICE_LIST_ITEM")live.unitPrice="999.1234";
    if(row.entityType==="PRICE_LIST_PACKAGE_ITEM")live.unitPrice="888.1234";
    if(row.entityType==="PACKAGE")live.items=[{testId:id(99),displayOrder:7,test:{code:"PRIVATE"}}];
    if(row.entityType==="PANEL")live.items=[{testId:id(99),displayOrder:1,required:false,test:{code:"PRIVATE"}}];
    return {...row,scopedLiveData:live};
  });
  const report=verified(rows);
  assert.ok(report);
  assert.equal(report.changedRows,5);
  assert.equal(report.unchangedRows,5);
  assert.deepEqual(report.classes.find(x=>x.entityType==="REFERENCE_INTERVAL")?.changedFields,["criticalLow"]);
  assert.deepEqual(report.classes.find(x=>x.entityType==="PRICE_LIST_ITEM")?.changedFields,["unitPrice"]);
  assert.deepEqual(report.classes.find(x=>x.entityType==="PACKAGE")?.changedFields,["items"]);
  const output=JSON.stringify(report);
  for(const secret of ["17.000001","999.1234","888.1234","PRIVATE",id(99)])
    assert.equal(output.includes(secret),false,"no medical/price/source values leaked");
});

test("F2: full-set helper is explicitly non-authorizing and bounded by caller's signed scope",()=>{
  const body=readFileSync("src/lib/catalog-f2-batch-reconciliation.ts","utf8");
  const commit=readFileSync("src/app/api/catalog/imports/[id]/commit/route.ts","utf8");
  assert.match(body,/f2GovernedReadinessPreview/);
  assert.match(body,/BUNDLE_REVIEW_MAX_ROWS/);
  assert.match(body,/wholeStageHmacVerified!==true/);
  assert.match(body,/currentTenClassScopeVerified!==true/);
  assert.match(body,/classes\.size!==catalogExportTypes\.size/);
  assert.doesNotMatch(body,/(?:\.create\(|\.update\(|\.upsert\(|\.delete\()/);
  assert.match(commit,/CONFIG_BUNDLE_REVIEW/);
  assert.match(commit,/CSV_REVIEW/);
});

test("F2: independent GET compiles the ten-class report only for dual-grant authenticated reviewer",()=>{
  const preflight=readFileSync("src/lib/catalog-mapping-inspection-preflight.ts","utf8");
  const get=readFileSync("src/app/api/catalog/imports/[id]/mapping-inspection/route.ts","utf8");
  const feedback=readFileSync("src/app/api/catalog/imports/[id]/mapping-feedback/route.ts","utf8");
  assert.match(preflight,/validatePolicyReviewBatchScope\(tx,/);
  assert.match(preflight,/verifyMappingDiscussionHistory\(/);
  assert.match(preflight,/matchesCatalogDriftObservation\(history\.draft\.observationToken,token\)/);
  assert.match(preflight,/SELECT id FROM organizations/);
  assert.match(preflight,/FOR UPDATE/);
  assert.match(preflight,/isolationLevel:"RepeatableRead"/);
  assert.match(preflight,/includeBatchReconciliation = false/);
  assert.match(preflight,/original\.has\(grant\) && current\.has\(grant\)/);
  assert.match(preflight,/catalog\.reference_ranges\.manage","pricing\.manage/);
  assert.match(preflight,/readCatalogLiveObservations\(\s*tx,scope,grantedBranchIds,byType\)/);
  assert.match(preflight,/f2ReadOnlyBatchReconciliation\(/);
  assert.match(preflight,/mapping_inspection_batch_reconciliation_invalid/);
  assert.match(get,/batchReconciliation:evidence\.batchReconciliation/);
  assert.match(get,/batchReconciliationCoverage:evidence\.batchReconciliationCoverage/);
  assert.match(get,/\},true\);/);
  assert.doesNotMatch(get,/export async function POST\(/);
  assert.match(feedback,/runIndependentMappingPreflight\(request,context,async evidence=>/);
  assert.doesNotMatch(feedback,/includeBatchReconciliation/);
});
