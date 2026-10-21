import test from "node:test";
import assert from "node:assert/strict";
import {LEGACY_COVERAGE_TYPE,LEGACY_COVERAGE_SOURCES} from "../src/lib/legacy-source-coverage.ts";
import {LEGACY_ROW_LINEAGE_TYPE} from "../src/lib/catalog-legacy-row-lineage.ts";
import {f3ScopedTargetKey,reconcileF3LegacyRowParity} from "../src/lib/legacy-f3-row-parity.ts";

const id=(n:number)=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const hex=(n:number)=>n.toString(16).padStart(64,"0");
const source={sourceName:"synthetic.mdb",sourceSha256:hex(99),sourceBytes:8192};
const columns=[["Test name",2,"TEST"],["normal",1,"REFERENCE_INTERVAL"],["price",1,"PRICE_LIST_ITEM"]] as const;
const coverage={schemaVersion:1 as const,evidenceType:LEGACY_COVERAGE_TYPE,...source,
  exportedAtUtc:"2026-10-21T12:00:00Z",includesPatientData:false as const,
  tables:LEGACY_COVERAGE_SOURCES.map(t=>{
    const match=columns.find(x=>x[0]===t.tableName);
    return {tableName:t.tableName,present:!!match,rowCount:match?.[1]??0,
      columnCount:match?2:0,schemaSha256:match?hex(150+columns.indexOf(match)):null};
  }),
};
const pages=columns.map(([table,count],n)=>({
  schemaVersion:1 as const,evidenceType:LEGACY_ROW_LINEAGE_TYPE,...source,
  tableName:table,schemaSha256:hex(150+n),digestKeyId:hex(200),
  sourceRowCount:count,chunkIndex:0,chunkCount:1,
  exportedAtUtc:"2026-10-21T12:00:00Z",includesPatientData:false as const,
  rows:Array.from({length:count},(_,i)=>({
    rowDigest:hex(1+n),occurrence:i+1,
  })),
}));
const author=id(70),reviewer=id(71);
const records=pages.flatMap((page,p)=>page.rows.map((entry,i)=>({
  sourceSha256:source.sourceSha256,sourceTable:page.tableName,
  sourceSchemaSha256:page.schemaSha256,digestKeyId:page.digestKeyId,
  rowDigest:entry.rowDigest,occurrence:entry.occurrence,revision:2,
  classification:"APPROVED_MAPPING" as const,
  targetType:columns[p][2],targetId:id(20+p+i),
  createdByUserId:author,mappedByUserId:author,
  reviewedByUserId:reviewer,reviewedAt:"2026-10-21T12:00:00Z",
})));
const targets=new Set(records.map(x=>f3ScopedTargetKey(x.targetType,x.targetId)));
const verify=(change:Record<string,unknown>={})=>
  reconcileF3LegacyRowParity({source,coverage,lineage:pages,
    persisted:records,verifiedScopedTargets:targets,...change});

test("F3 verifies exact row identity for all fifteen configured source tables",()=>{
  const result=verify();
  assert.equal(result.sourceTables,15);
  assert.equal(result.sourceRows,4);
  assert.equal(result.persistedRows,4);
  assert.equal(result.reviewedMappings,4);
  assert.equal(result.state,"FULL_ROW_LEDGER_RECONCILED");
  assert.equal(result.allOriginalRowsAccountedFor,true);
  assert.equal(result.allTargetsReviewedAndPresent,true);
  assert.equal(result.cutoverApproved,false);
  assert.equal(result.clinicalApproved,false);
  assert.equal(result.financialApproved,false);
  assert.equal(result.sourceIndependentlyCertified,false);
  const visible=JSON.stringify(result);
  for(const hidden of [hex(1),hex(200),id(20)])assert.equal(visible.includes(hidden),false);
});

test("F3 exposes missing/ambiguous/partially reviewed mapping counts without false cutover",()=>{
  const missing=verify({persisted:records.slice(0,-1)});
  assert.equal(missing.missingRows,1);
  assert.equal(missing.state,"SOURCE_TO_TARGET_REVIEW_INCOMPLETE");
  const unknown=records.map((r,i)=>i!==0?r:{...r,
    classification:"AMBIGUOUS" as const,targetType:null,targetId:null,
    reviewedByUserId:null,reviewedAt:null});
  const pending=verify({persisted:unknown});
  assert.equal(pending.ambiguousRows,1);
  assert.equal(pending.allTargetsReviewedAndPresent,false);
  assert.equal(verify({verifiedScopedTargets:new Set()}).missingLiveTargets,4);
  const excluded=records.map((r,i)=>i!==0?r:{...r,
    classification:"NOT_IMPORTED" as const,targetType:null,targetId:null,
    reviewedByUserId:null,reviewedAt:null});
  assert.equal(verify({persisted:excluded}).allTargetsReviewedAndPresent,false);
  const alias=records.map((r,i)=>i===1?{...r,targetId:records[0].targetId}:r);
  assert.equal(verify({persisted:alias}).multipleRowsPerTarget,1);
});

test("F3 rejects extra, duplicate, changed-schema, foreign or unauthorized source rows",()=>{
  const first=records[0];
  assert.throws(()=>verify({persisted:[...records,first]}));
  for(const bad of [
    {...first,sourceSha256:hex(7)}, {...first,sourceSchemaSha256:hex(7)},
    {...first,digestKeyId:hex(7)}, {...first,rowDigest:hex(7)},
    {...first,sourceTable:"untrusted"}, {...first,occurrence:3},
    {...first,targetType:"PRICE_LIST_ITEM"}, {...first,reviewedByUserId:author},
    {...first,classification:"ACTIVE"}, {...first,targetId:"bad"},
  ]){
    assert.throws(()=>verify({persisted:[bad,...records.slice(1)]}));
  }
  assert.throws(()=>verify({lineage:[...pages,pages[0]]}));
  assert.throws(()=>verify({lineage:[]}));
  assert.throws(()=>verify({coverage:{...coverage,sourceSha256:hex(6)}}));
});
