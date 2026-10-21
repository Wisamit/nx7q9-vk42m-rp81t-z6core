import {
  LEGACY_COVERAGE_SOURCES, parseLegacySourceCoverage,
  type LegacySourceCoverage,
} from "./legacy-source-coverage.ts";
import {
  legacyRowClassifications, legacyRowHex, legacyRowTargets, legacyRowUuid,
  type LegacyRowClassification, type LegacyRowManifest,
} from "./catalog-legacy-row-lineage.ts";
import { verifyLegacyEvidenceManifestPackage } from "./legacy-evidence-package-review.ts";

const rowKey=(table:string,digest:string,occurrence:number)=>
  JSON.stringify([table,digest,occurrence]);
const object=(value:unknown):value is Record<string,unknown>=>
  value!==null && typeof value==="object" && !Array.isArray(value);
const exact=(value:Record<string,unknown>,fields:readonly string[])=>
  Object.keys(value).sort().join(",")===[...fields].sort().join(",");

export const F3_TARGET_LINEAGE_TYPE="FAMILY_LAB_F3_TARGET_LINEAGE_RECONCILIATION_PRIVATE_V1";
export type F3TargetLineageRecord={
  sourceTable:string;sourceSha256:string;sourceSchemaSha256:string;
  digestKeyId:string;rowDigest:string;occurrence:number;
  classification:LegacyRowClassification;targetType:string|null;
  targetId:string|null;batchId:string|null;importRowId:string|null;
  revision:number;
};
const recordFields=[
  "sourceTable","sourceSha256","sourceSchemaSha256","digestKeyId",
  "rowDigest","occurrence","classification","targetType","targetId",
  "batchId","importRowId","revision",
] as const;
export type F3TargetLineageExport={
  schemaVersion:1;evidenceType:typeof F3_TARGET_LINEAGE_TYPE;
  organizationId:string;sourceSha256:string;rows:F3TargetLineageRecord[];
};

/**
 * Private interchange from a tenant-scoped, read-only SQL extraction.
 * No patient names, test values, pricing, notes or import-row JSON.
 * The caller must independently authenticate the SQL export's origin; this
 * parser cannot turn a JSON file into proof of a real database read.
 */
export function parseF3TargetLineageExport(value:unknown):F3TargetLineageExport{
  if(!object(value)||!exact(value,[
    "schemaVersion","evidenceType","organizationId","sourceSha256","rows",
  ]) || value.schemaVersion!==1 ||
     value.evidenceType!==F3_TARGET_LINEAGE_TYPE ||
     typeof value.organizationId!=="string"||
     !legacyRowUuid.test(value.organizationId)||
     typeof value.sourceSha256!=="string"||
     !legacyRowHex.test(value.sourceSha256)||
     !Array.isArray(value.rows) || value.rows.length>3_000_000)
    throw Error("f3_target_lineage_export_invalid");
  const rows:F3TargetLineageRecord[]=[];
  for(const row of value.rows){
    if(!object(row)||!exact(row,recordFields) ||
       typeof row.sourceTable!=="string"||
       !Object.hasOwn(legacyRowTargets,row.sourceTable) ||
       typeof row.sourceSha256!=="string"||
       row.sourceSha256!==value.sourceSha256 ||
       typeof row.sourceSchemaSha256!=="string"||
       !legacyRowHex.test(row.sourceSchemaSha256) ||
       typeof row.digestKeyId!=="string"||!legacyRowHex.test(row.digestKeyId)||
       typeof row.rowDigest!=="string"||!legacyRowHex.test(row.rowDigest)||
       (typeof row.occurrence!=="number" || !Number.isSafeInteger(row.occurrence) ||
        row.occurrence<1 || row.occurrence>10_000_000) ||
       !legacyRowClassifications.includes(row.classification as LegacyRowClassification)||
       (typeof row.revision!=="number" || !Number.isSafeInteger(row.revision) ||
        row.revision<0 || row.revision>100000)||
       (row.targetType!==null &&
         (typeof row.targetType!=="string" ||
         !legacyRowTargets[row.sourceTable]?.includes(row.targetType)))||
       (row.targetId!==null&&
         (typeof row.targetId!=="string"||!legacyRowUuid.test(row.targetId)))||
       (row.batchId!==null&&
         (typeof row.batchId!=="string"||!legacyRowUuid.test(row.batchId)))||
       (row.importRowId!==null&&
         (typeof row.importRowId!=="string"||!legacyRowUuid.test(row.importRowId)))||
       (row.importRowId!==null && row.batchId===null)||
       ((row.classification==="MAPPED"||row.classification==="APPROVED_MAPPING")!==
         (row.targetType!==null&&row.targetId!==null))||
       ((row.classification!=="MAPPED"&&row.classification!=="APPROVED_MAPPING")&&
         (row.targetType!==null||row.targetId!==null)))
      throw Error("f3_target_lineage_row_invalid");
    rows.push(row as F3TargetLineageRecord);
  }
  return {
    schemaVersion:1,evidenceType:F3_TARGET_LINEAGE_TYPE,
    organizationId:value.organizationId,
    sourceSha256:value.sourceSha256,rows,
  };
}

type F3TableSummary={
  tableName:string;present:boolean;sourceRows:number;targetLedgerRows:number;
  absentFromTarget:number;unresolved:number;ambiguous:number;
  notImported:number;mapped:number;approvedMapping:number;targetReuse:number;
  finding:"ABSENT_SOURCE_TABLE"|"SOURCE_EMPTY"|
    "TARGET_LEDGER_ROWS_MISSING"|"TARGET_REUSE_REQUIRES_REVIEW"|
    "UNRESOLVED_OR_UNAPPROVED"|"ROW_KEYS_MATCH_NOT_SOURCE_CERTIFICATION";
};
export type F3ReconciliationResult={
  state:"GAPS_REMAIN"|"ROW_KEYS_MATCH_REVIEW_ONLY";
  sourceTableCount:15;sourceRows:number;targetLedgerRows:number;
  absentFromTarget:number;unresolved:number;ambiguous:number;
  notImported:number;mapped:number;approvedMapping:number;
  targetReuse:number;tables:F3TableSummary[];
  originalSourceValuesVerified:false;
  independentlyAuthenticatedDatabaseExport:false;
  clinicalApprovalVerified:false;financialApprovalVerified:false;
  migrationCutoverApproved:false;liveWrites:false;
};

/**
 * Full multiset equality of every HMAC row identity against tenant lineage.
 * This deliberately does NOT interpret counts alone as row reconciliation.
 * Distinct duplicate rows are identified by digest + occurrence. Missing
 * source keys become explicit gaps; unexpected, duplicate or foreign keys
 * fail closed rather than disappear from report totals.
 */
export function reconcileF3LegacyTargets(input:{
  coverage:LegacySourceCoverage;
  lineage:readonly LegacyRowManifest[];
  targetExport:F3TargetLineageExport;
  expectedOrganizationId:string;
}):F3ReconciliationResult{
  const coverage=parseLegacySourceCoverage(input.coverage);
  const targets=parseF3TargetLineageExport(input.targetExport);
  if(targets.organizationId!==input.expectedOrganizationId||
     targets.sourceSha256!==coverage.sourceSha256)
    throw Error("f3_target_lineage_scope_mismatch");
  const packageEvidence=verifyLegacyEvidenceManifestPackage({
    source:{sourceName:coverage.sourceName,sourceSha256:coverage.sourceSha256,
      sourceBytes:coverage.sourceBytes},
    coverage,lineage:input.lineage,
  });
  // Prevent reusing an internally coherent but unrelated HMAC-key sequence.
  if(!packageEvidence.digestKeyId &&
     coverage.tables.some(table=>table.present))
    throw Error("f3_source_digest_key_missing");

  const keys=new Set<string>();
  const tableSources=new Map<string,Set<string>>();
  for(const page of input.lineage){
    const found=tableSources.get(page.tableName)||new Set<string>();
    for(const row of page.rows){
      const key=rowKey(page.tableName,row.rowDigest,row.occurrence);
      if(keys.has(key))throw Error("f3_source_duplicate_row");
      keys.add(key);found.add(key);
    }
    tableSources.set(page.tableName,found);
  }
  const byTable=new Map<string,F3TargetLineageRecord[]>();
  const found=new Set<string>();
  for(const item of targets.rows){
    const key=rowKey(item.sourceTable,item.rowDigest,item.occurrence);
    if(found.has(key))throw Error("f3_target_duplicate_row_identity");
    found.add(key);
    if(!keys.has(key))throw Error("f3_target_row_not_in_verified_source");
    const source=coverage.tables.find(t=>t.tableName===item.sourceTable);
    if(!source?.present||source.schemaSha256!==item.sourceSchemaSha256||
       item.digestKeyId!==packageEvidence.digestKeyId)
      throw Error("f3_target_source_schema_or_key_mismatch");
    const group=byTable.get(item.sourceTable)||[];
    group.push(item);byTable.set(item.sourceTable,group);
  }
  const total={sourceRows:0,targetLedgerRows:targets.rows.length,
    absentFromTarget:0,unresolved:0,ambiguous:0,notImported:0,
    mapped:0,approvedMapping:0,targetReuse:0};
  const tables:F3TableSummary[]=[];
  for(const expected of LEGACY_COVERAGE_SOURCES){
    const table=coverage.tables.find(x=>x.tableName===expected.tableName)!;
    const inLedger=byTable.get(expected.tableName)||[];
    const sourceRows=table.rowCount;
    const absentFromTarget=sourceRows-inLedger.length;
    if(absentFromTarget<0)throw Error("f3_target_source_count_exceeded");
    const counts={unresolved:0,ambiguous:0,notImported:0,
      mapped:0,approvedMapping:0,targetReuse:0};
    const targetIds=new Set<string>();
    for(const item of inLedger){
      const prop={
        UNRESOLVED:"unresolved",AMBIGUOUS:"ambiguous",
        NOT_IMPORTED:"notImported",MAPPED:"mapped",
        APPROVED_MAPPING:"approvedMapping",
      }[item.classification] as keyof typeof counts;
      counts[prop]++;
      if(item.targetId&&item.targetType){
        const target=JSON.stringify([item.targetType,item.targetId.toLowerCase()]);
        if(targetIds.has(target))counts.targetReuse++;
        targetIds.add(target);
      }
    }
    const finding:F3TableSummary["finding"]=
      !table.present?"ABSENT_SOURCE_TABLE":
      sourceRows===0?"SOURCE_EMPTY":
      absentFromTarget>0?"TARGET_LEDGER_ROWS_MISSING":
      counts.targetReuse>0?"TARGET_REUSE_REQUIRES_REVIEW":
      counts.unresolved+counts.ambiguous+counts.notImported+counts.mapped>0?
        "UNRESOLVED_OR_UNAPPROVED":"ROW_KEYS_MATCH_NOT_SOURCE_CERTIFICATION";
    tables.push({tableName:table.tableName,present:table.present,
      sourceRows,targetLedgerRows:inLedger.length,absentFromTarget,
      ...counts,finding});
    total.sourceRows+=sourceRows;
    total.absentFromTarget+=absentFromTarget;
    for(const field of ["unresolved","ambiguous","notImported",
      "mapped","approvedMapping","targetReuse"] as const)
      total[field]+=counts[field];
  }
  return {
    state:total.sourceRows===0 || total.absentFromTarget+total.unresolved+total.ambiguous+
      total.notImported+total.mapped+total.targetReuse>0?
      "GAPS_REMAIN":"ROW_KEYS_MATCH_REVIEW_ONLY",
    sourceTableCount:15,...total,tables,
    originalSourceValuesVerified:false,
    independentlyAuthenticatedDatabaseExport:false,
    clinicalApprovalVerified:false,financialApprovalVerified:false,
    migrationCutoverApproved:false,liveWrites:false,
  };
}
