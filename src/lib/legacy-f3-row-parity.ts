import {
  LEGACY_COVERAGE_SOURCES, type LegacySourceCoverage,
} from "./legacy-source-coverage.ts";
import {
  legacyLineageMappingAllowed, legacyRowClassifications,
  type LegacyRowClassification, type LegacyRowManifest,
} from "./catalog-legacy-row-lineage.ts";
import {verifyLegacyEvidenceManifestPackage} from "./legacy-evidence-package-review.ts";

const SHA=/^[a-f0-9]{64}$/;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const tableKey=(name:string,digest:string,occurrence:number)=>
  JSON.stringify([name,digest,occurrence]);
const targetKey=(type:string,id:string)=>JSON.stringify([type,id.toLowerCase()]);
export class F3RowParityError extends Error {
  constructor(readonly code:string){super(code);}
}
function invalid(code:string):never{throw new F3RowParityError(code);}
export type F3PersistedLineageRow={
  sourceSha256:string;sourceTable:string;sourceSchemaSha256:string;
  digestKeyId:string;rowDigest:string;occurrence:number;revision:number;
  classification:LegacyRowClassification;targetType:string|null;
  targetId:string|null;createdByUserId:string;
  mappedByUserId:string|null;reviewedByUserId:string|null;
  reviewedAt:string|null;
};
export type F3RowParityTable={
  tableName:string;present:boolean;sourceRows:number;
  persistedRows:number;missingRows:number;
  classifications:Readonly<Record<LegacyRowClassification,number>>;
  missingLiveTargets:number;multipleRowsPerTarget:number;
};
export type F3RowParityReport={
  state:"FULL_ROW_LEDGER_RECONCILED"|"SOURCE_TO_TARGET_REVIEW_INCOMPLETE";
  sourceTables:number;sourceRows:number;persistedRows:number;
  missingRows:number;unresolvedRows:number;ambiguousRows:number;
  reviewedMappings:number;missingLiveTargets:number;multipleRowsPerTarget:number;
  explicitlyNotImported:number;tables:readonly F3RowParityTable[];
  stageSourceHmacReplayMatched:boolean;
  allOriginalRowsAccountedFor:boolean;
  allTargetsReviewedAndPresent:boolean;
  // A software reconciliation with synthetic evidence is NOT a qualified
  // clinical, financial or migration cutover approval.
  sourceIndependentlyCertified:false;clinicalApproved:false;
  financialApproved:false;cutoverApproved:false;
};
/**
 * Strict, bounded 15-table source-HMAC identity -> staged target lineage
 * reconciliation. Runs on vetted PRIVATE evidence and tenant-scoped SQL
 * rows, not untrusted HTTP JSON. Never logs or returns HMAC digests, source
 * values, target identifiers or patient data.
 *
 * verifiedScopedTargets is a set of keys FROM live tenant/branch/department-
 * authorized existence reads in the same snapshot. Without those reads,
 * mapped rows remain unresolved rather than implicitly considered present.
 *
 * This proves row-accounting parity against the supplied evidence, not
 * origin authenticity or human approval. A later operational run must use
 * real ACE replay and independently certified target mapping.
 */
export function reconcileF3LegacyRowParity(input:{
  source:Pick<LegacySourceCoverage,"sourceName"|"sourceSha256"|"sourceBytes">;
  coverage:LegacySourceCoverage;
  lineage:readonly LegacyRowManifest[];
  replayedLineage?:readonly LegacyRowManifest[];
  persisted:readonly F3PersistedLineageRow[];
  verifiedScopedTargets?:ReadonlySet<string>;
}):F3RowParityReport{
  const {source,coverage,lineage,persisted}=input;
  const inventory=verifyLegacyEvidenceManifestPackage({
    source,coverage,lineage,replayedLineage:input.replayedLineage,
  });
  const expected=new Map<string,{tableName:string;schemaSha256:string;digestKeyId:string}>();
  for(const page of lineage){
    for(const row of page.rows){
      const key=tableKey(page.tableName,row.rowDigest,row.occurrence);
      if(expected.has(key))invalid("f3_source_duplicate_row_across_pages");
      expected.set(key,{
        tableName:page.tableName,schemaSha256:page.schemaSha256,
        digestKeyId:page.digestKeyId,
      });
    }
  }
  if(expected.size!==inventory.masterRows||persisted.length>expected.size)
    invalid("f3_inconsistent_source_inventory");
  const classes=legacyRowClassifications;
  const byTable=new Map<string,F3RowParityTable>();
  const targetCounters=new Map<string,{count:number;tables:Map<string,number>}>();
  for(const item of inventory.tables){
    byTable.set(item.tableName,{
      tableName:item.tableName,present:item.present,sourceRows:item.sourceRows,
      persistedRows:0,missingRows:0,
      classifications:{UNRESOLVED:0,AMBIGUOUS:0,NOT_IMPORTED:0,
        MAPPED:0,APPROVED_MAPPING:0},
      missingLiveTargets:0,multipleRowsPerTarget:0,
    });
  }
  const seen=new Set<string>();
  let unresolved=0,ambiguous=0,reviewed=0,notImported=0,missingTarget=0;
  for(const row of persisted){
    if(row.sourceSha256!==coverage.sourceSha256 ||
       !SHA.test(row.sourceSchemaSha256)||!SHA.test(row.digestKeyId)||
       !SHA.test(row.rowDigest)||
       !Number.isSafeInteger(row.occurrence)||row.occurrence<1||
       !Number.isSafeInteger(row.revision)||row.revision<0||
       !UUID.test(row.createdByUserId)||
       !classes.includes(row.classification))
      invalid("f3_foreign_or_corrupt_persisted_row");
    const key=tableKey(row.sourceTable,row.rowDigest,row.occurrence);
    const prior=expected.get(key);
    if(!prior||seen.has(key)||
       row.sourceSchemaSha256!==prior.schemaSha256||
       row.digestKeyId!==prior.digestKeyId)
      invalid("f3_unexpected_duplicate_or_schema_mismatched_row");
    seen.add(key);
    const table=byTable.get(row.sourceTable);
    if(!table)invalid("f3_unknown_source_table");
    table.persistedRows++;
    table.classifications[row.classification]++;
    const mapped=row.classification==="MAPPED"||
      row.classification==="APPROVED_MAPPING";
    if(mapped){
      if(row.targetType===null||row.targetId===null||
         !UUID.test(row.targetId)||
         !legacyLineageMappingAllowed(row.sourceTable,row.targetType)||
         !row.mappedByUserId||!UUID.test(row.mappedByUserId)||
         row.mappedByUserId===row.createdByUserId && row.revision<1)
        invalid("f3_invalid_mapped_target");
      if(row.classification==="APPROVED_MAPPING"){
        if(!row.reviewedByUserId||!UUID.test(row.reviewedByUserId)||
           !row.reviewedAt||!Number.isFinite(Date.parse(row.reviewedAt))||
           row.reviewedByUserId===row.createdByUserId||
           row.reviewedByUserId===row.mappedByUserId||
           row.revision<2)
          invalid("f3_invalid_independent_mapping_review");
        reviewed++;
      }else unresolved++;
      const target=targetKey(row.targetType,row.targetId);
      const usage=targetCounters.get(target)??{count:0,tables:new Map<string,number>()};
      usage.count++;
      usage.tables.set(row.sourceTable,(usage.tables.get(row.sourceTable)||0)+1);
      targetCounters.set(target,usage);
      if(!input.verifiedScopedTargets?.has(target)){
        table.missingLiveTargets++;missingTarget++;
      }
    }else{
      if(row.targetId!==null||row.targetType!==null ||
         row.reviewedByUserId!==null||row.reviewedAt!==null)
        invalid("f3_unmapped_row_with_target_or_approval");
      if(row.classification==="UNRESOLVED")unresolved++;
      else if(row.classification==="AMBIGUOUS")ambiguous++;
      else notImported++;
    }
  }
  let missing=0,multiple=0;
  for(const table of byTable.values()){
    table.missingRows=table.sourceRows-table.persistedRows;
    if(table.missingRows<0)invalid("f3_source_row_overflow");
    missing+=table.missingRows;
  }
  for(const usage of targetCounters.values()){
    if(usage.count>1){
      multiple+=usage.count-1;
      // Aliases can legitimately share one target. Count every affected
      // table without quadratic scans or silently certifying cardinality.
      for(const [tableName,count] of usage.tables)
        byTable.get(tableName)!.multipleRowsPerTarget+=count;
    }
  }
  const accounted=missing===0;
  const resolved=accounted&&unresolved===0&&ambiguous===0&&
    notImported===0&&missingTarget===0&&multiple===0;
  return {
    state:resolved?"FULL_ROW_LEDGER_RECONCILED":"SOURCE_TO_TARGET_REVIEW_INCOMPLETE",
    sourceTables:LEGACY_COVERAGE_SOURCES.length,
    sourceRows:inventory.masterRows,persistedRows:persisted.length,
    missingRows:missing,unresolvedRows:unresolved,ambiguousRows:ambiguous,
    reviewedMappings:reviewed,missingLiveTargets:missingTarget,
    multipleRowsPerTarget:multiple,explicitlyNotImported:notImported,
    tables:[...byTable.values()],stageSourceHmacReplayMatched:
      inventory.sourceHmacAceReplayMatches,
    allOriginalRowsAccountedFor:accounted,
    allTargetsReviewedAndPresent:resolved,
    sourceIndependentlyCertified:false,clinicalApproved:false,
    financialApproved:false,cutoverApproved:false,
  };
}
/** Make a scoped key from a verified tenant-local live master lookup. */
export function f3ScopedTargetKey(type:string,id:string):string{
  if(!/^[A-Z_]+$/.test(type)||!UUID.test(id))invalid("f3_invalid_target_key");
  return targetKey(type,id);
}
