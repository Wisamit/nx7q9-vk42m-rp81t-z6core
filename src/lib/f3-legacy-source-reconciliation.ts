import type {F3LegacyExtractionManifest,F3LegacyRowEvidence}
  from "./f3-legacy-extraction-manifest.ts";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA=/^[0-9a-f]{64}$/;
export type F3LegacyDisposition=
  "UNRESOLVED"|"AMBIGUOUS"|"NOT_IMPORTED"|"MAPPED"|"APPROVED_MAPPING";
export type F3LineageDecision={
  organizationId:string;sourceSha256:string;digestKeyId:string;
  sourceTable:string;sourceSchemaSha256:string;
  rowDigest:string;occurrence:number;
  classification:F3LegacyDisposition;
  targetType:string|null;targetId:string|null;
};
const mapped=new Set<F3LegacyDisposition>(["MAPPED","APPROVED_MAPPING"]);
const targetTypes=new Set([
  "TEST","PANEL","PACKAGE","COMPONENT","UNIT","CONTAINER",
  "REFERENCE_INTERVAL","PRICE_LIST","PRICE_LIST_ITEM",
  "PRICE_LIST_PACKAGE_ITEM","REFERRER","SOURCE","CLIENT",
  "ORGANISM","ANTIBIOTIC","COMMENT_TEMPLATE",
]);
const key=(row:F3LegacyRowEvidence)=>[
  row.sourceTable.toLowerCase(),row.sourceSchemaSha256,
  row.rowDigest,row.occurrence,
].join("\u0000");
export type F3ReconciliationReport={
  state:"SYNTHETIC_RECONCILIATION_ONLY";
  sourceRows:number;matchedRows:number;missingRows:number;
  duplicates:number;unknownRows:number;manyToOneTargets:number;
  dispositions:Readonly<Record<F3LegacyDisposition,number>>;
  byTable:readonly {
    table:string;sourceRows:number;reconciledRows:number;
    missingRows:number;ambiguousRows:number;
  }[];
  syntheticFullyClassified:boolean;
  originalMdbProven:false;qualifiedMappingApproved:false;
  productionReady:false;
};

/**
 * Reconcile already AUTHENTICATED, SCOPED DB ledger rows against an offline
 * source fingerprint. Neither a caller's classification enum nor the input
 * fingerprint proves clinical/financial authority or original MDB lineage.
 *
 * A row is identified by (source table, exact Access schema, keyed digest,
 * occurrence). Do NOT silently map by test name/code or collapse duplicates.
 * Errors fail closed; partial coverage remains a partial report.
 */
export function reconcileF3LegacySource(input:{
  manifest:F3LegacyExtractionManifest;
  lineage:readonly F3LineageDecision[];
  tenantAndTargetScopeVerified:true;
}):F3ReconciliationReport{
  const {manifest,lineage}=input;
  if(input.tenantAndTargetScopeVerified!==true||
     manifest.format!=="F3_LEGACY_SOURCE_FINGERPRINT_V1"||
     !UUID.test(manifest.organizationId)||!SHA.test(manifest.sourceSha256)||
     !SHA.test(manifest.digestKeyId)||manifest.tableCount!==manifest.tables.length||
     manifest.rowCount!==manifest.rows.length||manifest.tableCount<1||
     manifest.tableCount>15||manifest.rowCount>20000||
     manifest.sourceBytesVerified!==false||
     manifest.realLegacyParityVerified!==false||
     manifest.operationalReady!==false||lineage.length>20000)
    throw Error("f3_reconciliation_invalid_source_evidence");
  const source=new Map<string,F3LegacyRowEvidence>();
  const schemaByTable=new Map<string,string>();
  let counted=0;
  for(const table of manifest.tables){
    if(!table.sourceTable||!SHA.test(table.sourceSchemaSha256)||
       !Number.isSafeInteger(table.rows)||table.rows<0||
       schemaByTable.has(table.sourceTable.toLowerCase()))
      throw Error("f3_reconciliation_invalid_table_coverage");
    schemaByTable.set(table.sourceTable.toLowerCase(),table.sourceSchemaSha256);
    counted+=table.rows;
  }
  if(counted!==manifest.rowCount)throw Error("f3_reconciliation_row_count_mismatch");
  for(const row of manifest.rows){
    if(!SHA.test(row.rowDigest)||!SHA.test(row.sourceSchemaSha256)||
       !Number.isSafeInteger(row.occurrence)||row.occurrence<1||
       schemaByTable.get(row.sourceTable.toLowerCase())!==row.sourceSchemaSha256)
      throw Error("f3_reconciliation_invalid_source_row");
    const id=key(row);
    if(source.has(id))throw Error("f3_reconciliation_duplicate_source_identity");
    source.set(id,row);
  }
  const statuses:Record<F3LegacyDisposition,number>={
    UNRESOLVED:0,AMBIGUOUS:0,NOT_IMPORTED:0,MAPPED:0,APPROVED_MAPPING:0,
  };
  const selected=new Set<string>(),targetCounts=new Map<string,number>();
  for(const item of lineage){
    if(item.organizationId!==manifest.organizationId||
       item.sourceSha256!==manifest.sourceSha256||
       item.digestKeyId!==manifest.digestKeyId||
       !Object.hasOwn(statuses,item.classification)||
       !source.has(key(item))||selected.has(key(item)))
      throw Error("f3_reconciliation_foreign_or_duplicate_mapping");
    selected.add(key(item));
    if(mapped.has(item.classification)){
      if(!item.targetType||!targetTypes.has(item.targetType)||
         !item.targetId||!UUID.test(item.targetId))
        throw Error("f3_reconciliation_unverified_target_identity");
      const target=item.targetType+":"+item.targetId.toLowerCase();
      targetCounts.set(target,(targetCounts.get(target)||0)+1);
    }else if(item.targetType!==null||item.targetId!==null)
      throw Error("f3_reconciliation_unreviewed_target_link");
    statuses[item.classification]++;
  }
  const byTable=manifest.tables.map(table=>{
    const stem=table.sourceTable.toLowerCase();
    const entries=lineage.filter(x=>x.sourceTable.toLowerCase()===stem);
    return {table:table.sourceTable,sourceRows:table.rows,
      reconciledRows:entries.length,
      missingRows:table.rows-entries.length,
      ambiguousRows:entries.filter(x=>x.classification==="AMBIGUOUS").length};
  }).sort((a,b)=>a.table.toLowerCase().localeCompare(b.table.toLowerCase()));
  const duplicates=manifest.tables.reduce((n,t)=>{
    // Duplicate source content remains individually tracked by occurrence;
    // the count is evidence, not permission to collapse two rows.
    return n+(t.duplicateContentRows||0);
  },0);
  const manyToOneTargets=[...targetCounts.values()]
    .filter(count=>count>1).reduce((n,count)=>n+count-1,0);
  const missing=manifest.rowCount-selected.size;
  return {
    state:"SYNTHETIC_RECONCILIATION_ONLY",
    sourceRows:manifest.rowCount,matchedRows:selected.size,
    missingRows:missing,duplicates,unknownRows:0,
    manyToOneTargets,dispositions:statuses,byTable,
    syntheticFullyClassified:missing===0&&
      statuses.UNRESOLVED===0&&statuses.AMBIGUOUS===0&&
      manyToOneTargets===0,
    originalMdbProven:false,qualifiedMappingApproved:false,
    productionReady:false,
  };
}
