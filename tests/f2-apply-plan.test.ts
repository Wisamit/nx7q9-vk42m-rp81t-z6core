import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {catalogExportTypes} from "../src/lib/catalog-configuration-export.ts";
import {catalogBundleAllowedSourceFields} from "../src/lib/catalog-bundle-source-boundary.ts";
import {compileF2ApplyPlan,summarizeF2ApplyPlan,
 type F2ApplySourceRow} from "../src/lib/catalog-f2-apply-plan.ts";

const id=(n:number)=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const effectiveAt="2026-12-01T00:00:00.000Z";
const make=():F2ApplySourceRow[]=>[...catalogExportTypes].map((entityType,i)=>{
  const source:Record<string,unknown>={};
  for(const field of catalogBundleAllowedSourceFields[entityType])
    source[field]=null;
  source.id=id(i+1);
  if(Object.hasOwn(source,"code"))source.code="C-"+i;
  source.createdAt="2026-01-01T00:00:00.000Z";
  source.updatedAt="2026-01-01T00:00:00.000Z";
  const live=structuredClone(source);
  live.updatedAt="2026-10-01T00:00:00.000Z";
  return {rowNumber:i+1,entityType,sourceData:source,
    normalizedData:{id:source.id},scopedLiveData:live};
});
const plan=(rows:readonly F2ApplySourceRow[])=>compileF2ApplyPlan({
  rows,effectiveAt,signedStageVerified:true,
  independentDomainApprovalsVerified:true,scopedLiveSnapshotVerified:true,
});
test("F2: signed whole-value ten-class plan ignores historical updatedAt and never leaks sensitive snapshots to UI",()=>{
  const rows=make();const p=plan(rows);
  assert.ok(p);assert.equal(p.totalRows,10);
  assert.equal(p.unchangedRows,10);assert.equal(p.changedRows,0);
  assert.equal(p.rows.length,10);
  assert.match(p.planDigest,/^[a-f0-9]{64}$/);
  for(const row of p.rows){
    assert.equal(row.operation,"UNCHANGED");
    assert.equal(row.changedFields.length,0);
    assert.equal(row.desiredSnapshot.updatedAt,"2026-10-01T00:00:00.000Z");
  }
  const summary=summarizeF2ApplyPlan(p);
  assert.equal(summary.masterWritesPerformed,false);
  assert.equal(summary.reviewOnly,true);
  assert.equal(JSON.stringify(summary).includes(id(1)),false);
  assert.equal(JSON.stringify(summary).includes(p.planDigest),false);
});
test("F2: metadata, composite and effective-dated classes are explicit operations",()=>{
  const rows=make().map(row=>{
    const source={...(row.sourceData as Record<string,unknown>)};
    if(row.entityType==="UNIT")source.nameEn="new unit text";
    if(row.entityType==="CONTAINER")source.tubeColor="violet";
    if(row.entityType==="PANEL")source.items=[{testId:id(95),displayOrder:1,required:true,test:{code:"A"}}];
    if(row.entityType==="PACKAGE")source.items=[{testId:id(95),displayOrder:1,test:{code:"A"}}];
    if(row.entityType==="REFERENCE_INTERVAL")source.criticalLow="1.000100";
    if(row.entityType==="PRICE_LIST_ITEM")source.unitPrice="13.5555";
    if(row.entityType==="PRICE_LIST_PACKAGE_ITEM")source.unitPrice="64.9999";
    return {...row,sourceData:source};
  });
  const p=plan(rows);assert.ok(p);
  assert.equal(p.changedRows,7);
  assert.equal(p.operations.SCALAR_VERSIONED_CHANGE,2);
  assert.equal(p.operations.COMPOSITE_MEMBERSHIP_CHANGE,2);
  assert.equal(p.operations.EFFECTIVE_DATED_NEW_VERSION,3);
  assert.deepEqual(p.rows.find(r=>r.entityType==="PRICE_LIST_ITEM")?.changedFields,["unitPrice"]);
  assert.deepEqual(p.rows.find(r=>r.entityType==="REFERENCE_INTERVAL")?.changedFields,["criticalLow"]);
  const s=JSON.stringify(summarizeF2ApplyPlan(p));
  for(const secret of ["1.000100","13.5555","64.9999",id(95)])
    assert.equal(s.includes(secret),false);
  const duplicate=plan([...rows,{...rows[0],rowNumber:11}]);
  assert.equal(duplicate,null,"duplicates are not independent revisions");
  assert.equal(plan([...rows].reverse()),null,"stage order must remain authenticated");
});
test("F2: reject unauthorized, cross-installation identity swaps, remaps and tampered field shapes",()=>{
  const rows=make();
  const sample={...rows[0],sourceData:{...(rows[0].sourceData as object),id:id(111)}};
  assert.equal(plan(rows.map((r,i)=>i===0?sample:r)),null);
  assert.equal(plan(rows.map((r,i)=>i===0?{...r,
    sourceData:{...(r.sourceData as object),code:"CHANGED_IDENTITY"}}:r)),null);
  assert.equal(plan(rows.map((r,i)=>i===0?{...r,
    sourceData:{...(r.sourceData as object),departmentId:id(222)}}:r)),null);
  assert.equal(plan(rows.map((r,i)=>i===0?{...r,
    scopedLiveData:{...(r.scopedLiveData as object),extraneous:true}}:r)),null);
  assert.equal(plan(rows.map((r,i)=>i===0?{...r,scopedLiveData:null}:r)),null);
  assert.equal(plan(rows.map((r,i)=>i===0?{...r,
    sourceData:{...(r.sourceData as object),unexpected:true}}:r)),null);
  const interval=rows.findIndex(r=>r.entityType==="REFERENCE_INTERVAL");
  assert.equal(plan(rows.map((r,i)=>i===interval?{...r,
    sourceData:{...(r.sourceData as object),effectiveFrom:"2026-01-01T00:00:00.000Z"}}:r)),null);
  assert.equal(compileF2ApplyPlan({rows,effectiveAt,
    signedStageVerified:false as true,independentDomainApprovalsVerified:true,
    scopedLiveSnapshotVerified:true}),null);
  assert.equal(compileF2ApplyPlan({rows,effectiveAt,
    signedStageVerified:true,independentDomainApprovalsVerified:false as true,
    scopedLiveSnapshotVerified:true}),null);
  assert.equal(compileF2ApplyPlan({rows,effectiveAt:"invalid",
    signedStageVerified:true,independentDomainApprovalsVerified:true,
    scopedLiveSnapshotVerified:true}),null);
});
test("F2: plan remains separate from unapproved import master commit route",()=>{
  const helper=readFileSync("src/lib/catalog-f2-apply-plan.ts","utf8");
  const commit=readFileSync("src/app/api/catalog/imports/[id]/commit/route.ts","utf8");
  assert.match(helper,/EFFECTIVE_DATED_NEW_VERSION/);
  assert.match(helper,/originalSnapshot/);
  assert.match(helper,/desiredSnapshot/);
  assert.match(helper,/independentDomainApprovalsVerified!==true/);
  assert.doesNotMatch(helper,/tx\.(?:labTest|priceList|referenceInterval|priceListItem)\.(?:update|upsert|create)/);
  assert.match(commit,/CONFIG_BUNDLE_REVIEW/);
});
