import test from "node:test";
import assert from "node:assert/strict";
import {
  LEGACY_COVERAGE_SOURCES, LEGACY_COVERAGE_TYPE,
  parseLegacySourceCoverage,
} from "../src/lib/legacy-source-coverage.ts";
import {
  LEGACY_ROW_LINEAGE_TYPE, parseLegacyRowManifest,
} from "../src/lib/catalog-legacy-row-lineage.ts";
import {
  F3_TARGET_LINEAGE_TYPE,parseF3TargetLineageExport,
  reconcileF3LegacyTargets,
} from "../src/lib/f3-legacy-target-reconciliation.ts";

const id=(i:number)=>"00000000-0000-4000-8000-"+String(i).padStart(12,"0");
const sha=(letter:string)=>letter.repeat(64);
const source={sourceName:"synthetic-only.mdb",sourceSha256:sha("a"),
  sourceBytes:8192};
const schema=sha("b"),hmacKey=sha("c"),when="2026-10-21T00:00:00.000Z";
function fixture(options:{fullCoverage?:boolean;crossTableReuse?:boolean}={}){
  const coverage=parseLegacySourceCoverage({
    schemaVersion:1,evidenceType:LEGACY_COVERAGE_TYPE,...source,
    exportedAtUtc:when,includesPatientData:false,
    tables:LEGACY_COVERAGE_SOURCES.map(({tableName})=>{
      const present=Boolean(options.fullCoverage ||
        ["Test name","price"].includes(tableName) ||
        (options.crossTableReuse && tableName==="test"));
      return {tableName,present,rowCount:tableName==="Test name"?501:
        tableName==="price"?2:tableName==="test" && options.crossTableReuse?1:0,
        columnCount:present?3:0,
        schemaSha256:present?schema:null};
    }),
  });
  const hashes=Array.from({length:501},(_,i)=>({
    rowDigest:sha("d"),occurrence:i+1,
  }));
  const manifest=(tableName:string,rows:{rowDigest:string;occurrence:number}[],
    chunkIndex:number,chunkCount:number,sourceRowCount:number)=>parseLegacyRowManifest({
    schemaVersion:1,evidenceType:LEGACY_ROW_LINEAGE_TYPE,...source,
    tableName,schemaSha256:schema,digestKeyId:hmacKey,sourceRowCount,
    chunkIndex,chunkCount,exportedAtUtc:when,includesPatientData:false,rows,
  });
  const lineage=[
    manifest("Test name",hashes.slice(0,500),0,2,501),
    manifest("Test name",hashes.slice(500),1,2,501),
    manifest("price",[{rowDigest:sha("e"),occurrence:1},
      {rowDigest:sha("e"),occurrence:2}],0,1,2),
  ];
  if (options.crossTableReuse) {
    lineage.push(manifest("test",[{rowDigest:sha("f"),occurrence:1}],0,1,1));
  }
  if (options.fullCoverage) {
    for (const {tableName} of LEGACY_COVERAGE_SOURCES) {
      if (tableName!=="Test name" && tableName!=="price" &&
          !(options.crossTableReuse && tableName==="test"))
        lineage.push(manifest(tableName,[],0,1,0));
    }
  }
  const rows=lineage.flatMap(page=>page.rows.map((row,i)=>({
    sourceTable:page.tableName,sourceSha256:source.sourceSha256,
    sourceSchemaSha256:schema,digestKeyId:hmacKey,
    rowDigest:row.rowDigest,occurrence:row.occurrence,
    classification:"APPROVED_MAPPING" as const,
    targetType:page.tableName==="price"?"PRICE_LIST_ITEM":"TEST",
    targetId:id(100+page.chunkIndex*500+i+
      (page.tableName==="price"?1000:0)),
    batchId:null,importRowId:null,revision:1,
  })));
  const targetExport=parseF3TargetLineageExport({
    schemaVersion:1,evidenceType:F3_TARGET_LINEAGE_TYPE,
    organizationId:id(1),sourceSha256:source.sourceSha256,rows,
  });
  return {coverage,lineage,targetExport};
}
const check=(x:ReturnType<typeof fixture>)=>reconcileF3LegacyTargets({
  ...x,expectedOrganizationId:id(1),
});
test("F3: 15-table HMAC row multiset and duplicate occurrences reconcile 503 rows with no certification",()=>{
  const v=check(fixture());
  assert.equal(v.sourceTableCount,15);
  assert.equal(v.sourceRows,503);
  assert.equal(v.targetLedgerRows,503);
  assert.equal(v.absentFromTarget,0);
  assert.equal(v.approvedMapping,503);
  assert.equal(v.targetReuse,0);
  assert.equal(v.tables.length,15);
  assert.equal(v.state,"GAPS_REMAIN",
    "13 absent required source tables cannot be declared reconciled at the aggregate level");
  assert.equal(v.originalSourceValuesVerified,false);
  assert.equal(v.independentlyAuthenticatedDatabaseExport,false);
  assert.equal(v.clinicalApprovalVerified,false);
  assert.equal(v.financialApprovalVerified,false);
  assert.equal(v.migrationCutoverApproved,false);
  assert.equal(v.liveWrites,false);
  const output=JSON.stringify(v);
  assert.equal(output.includes(sha("d")),false,"HMAC digest must remain private");
  assert.equal(output.includes(id(100)),false,"target UUID must remain private");
});
test("F8 §88: fully covered 15-table metadata can reach review-only row-key parity without GO",()=>{
  const v=check(fixture({fullCoverage:true}));
  assert.equal(v.sourceTableCount,15);
  assert.equal(v.sourceRows,503);
  assert.equal(v.absentFromTarget,0);
  assert.equal(v.targetReuse,0);
  assert.equal(v.tables.filter(t=>!t.present).length,0);
  assert.equal(v.state,"ROW_KEYS_MATCH_REVIEW_ONLY");
  assert.equal(v.originalSourceValuesVerified,false);
  assert.equal(v.independentlyAuthenticatedDatabaseExport,false);
  assert.equal(v.clinicalApprovalVerified,false);
  assert.equal(v.financialApprovalVerified,false);
  assert.equal(v.migrationCutoverApproved,false);
});

test("F8 §88: two different Access tables mapping same TEST target is a cross-table reuse gap",()=>{
  // Test name and test may legitimately have related names, but two original
  // source row HMAC identities do not automatically authorize a shared target.
  const v=check(fixture({fullCoverage:true,crossTableReuse:true}));
  assert.equal(v.sourceRows,504);
  assert.equal(v.targetLedgerRows,504);
  assert.equal(v.absentFromTarget,0);
  assert.equal(v.targetReuse,1);
  assert.equal(v.state,"GAPS_REMAIN");
  assert.equal(v.tables.find(t=>t.tableName==="test")?.targetReuse,1);
  assert.equal(v.tables.find(t=>t.tableName==="test")?.finding,
    "TARGET_REUSE_REQUIRES_REVIEW");
  assert.equal(v.originalSourceValuesVerified,false);
  assert.equal(JSON.stringify(v).includes(id(100)),false,
    "cross-table target identity must remain private");
});

test("F3: missing source-row assignment is explicit; ambiguous, not-imported and mapped are not approved",()=>{
  const f=fixture();
  const exportRows=f.targetExport.rows.slice(0,-1).map((item,i)=>
    i===0?{...item,classification:"AMBIGUOUS" as const,targetType:null,targetId:null}:
    i===1?{...item,classification:"NOT_IMPORTED" as const,targetType:null,targetId:null}:
    i===2?{...item,classification:"MAPPED" as const}:item);
  const report=check({...f,targetExport:{...f.targetExport,rows:exportRows}});
  assert.equal(report.state,"GAPS_REMAIN");
  assert.equal(report.absentFromTarget,1);
  assert.equal(report.ambiguous,1);
  assert.equal(report.notImported,1);
  assert.equal(report.mapped,1);
  assert.equal(report.approvedMapping,499);
  assert.equal(report.tables.find(t=>t.tableName==="price")?.finding,
    "TARGET_LEDGER_ROWS_MISSING");
});
test("F3: a missing source table is not silently counted as imported",()=>{
  const f=fixture(),report=check(f);
  assert.equal(report.tables.find(t=>t.tableName==="Fungi")?.finding,
    "ABSENT_SOURCE_TABLE");
});
test("F3: reused same target is separately flagged even when all source HMACs exist",()=>{
  const f=fixture();
  const targetRows=f.targetExport.rows.map((row,i)=>i===1?
    {...row,targetId:f.targetExport.rows[0].targetId}:row);
  const report=check({...f,targetExport:{...f.targetExport,rows:targetRows}});
  assert.equal(report.state,"GAPS_REMAIN");
  assert.equal(report.targetReuse,1);
  assert.equal(report.tables.find(t=>t.tableName==="Test name")?.finding,
    "TARGET_REUSE_REQUIRES_REVIEW");
});
test("F3: cross-tenant, cross-source, unknown rows and duplicate lineage keys fail closed",()=>{
  const f=fixture(),record=f.targetExport.rows[0];
  assert.throws(()=>reconcileF3LegacyTargets({
    ...f,expectedOrganizationId:id(999),
  }),/scope_mismatch/);
  assert.throws(()=>check({...f,targetExport:{...f.targetExport,
    sourceSha256:sha("e")}}),/row_invalid|scope_mismatch/);
  // The mismatch is detected inside the strict private-export parser before
  // cross-source scope evaluation; both are fail-closed responses.
  assert.throws(()=>check({...f,targetExport:{...f.targetExport,
    rows:[...f.targetExport.rows,f.targetExport.rows[0]]}}),/duplicate_row_identity/);
  assert.throws(()=>check({...f,targetExport:{...f.targetExport,
    rows:[{...record,rowDigest:sha("f")},...f.targetExport.rows.slice(1)]}}),
    /not_in_verified_source/);
  assert.throws(()=>check({...f,targetExport:{...f.targetExport,
    rows:[{...record,sourceSchemaSha256:sha("f")},...f.targetExport.rows.slice(1)]}}),
    /source_schema_or_key_mismatch/);
  assert.throws(()=>check({...f,targetExport:{...f.targetExport,
    rows:[{...record,digestKeyId:sha("f")},...f.targetExport.rows.slice(1)]}}),
    /source_schema_or_key_mismatch/);
  assert.throws(()=>check({...f,targetExport:{...f.targetExport,
    rows:[{...record,classification:"SILENTLY_APPROVED"} as never,...f.targetExport.rows.slice(1)]}}),
    /row_invalid/);
  assert.throws(()=>check({...f,targetExport:{...f.targetExport,
    rows:[{...record,targetType:"UNRELATED",targetId:id(150)} as never,
      ...f.targetExport.rows.slice(1)]}}),/row_invalid/);
  assert.throws(()=>check({...f,targetExport:{...f.targetExport,
    rows:[{...record,patientName:"Not permitted"} as never,
      ...f.targetExport.rows.slice(1)]}}),/row_invalid/);
});
