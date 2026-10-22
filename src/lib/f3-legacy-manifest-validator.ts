import {LEGACY_COVERAGE_SOURCES} from "./legacy-source-coverage.ts";
import type {F3LegacyExtractionManifest}
  from "./f3-legacy-extraction-manifest.ts";

const SHA=/^[a-f0-9]{64}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const object=(v:unknown):v is Record<string,unknown> =>
  v!==null&&typeof v==="object"&&!Array.isArray(v);
const exact=(v:Record<string,unknown>,keys:readonly string[])=>
  Object.keys(v).sort().join(",")===[...keys].sort().join(",");
const ALLOWED: ReadonlySet<string>=new Set<string>(
  LEGACY_COVERAGE_SOURCES.map(x=>x.tableName));
/**
 * Validate the shape of a digest-only SOURCE evidence document received at
 * the HTTP boundary. Reject any additional metadata/source values, including
 * raw Access cell contents accidentally copied into a review upload.
 *
 * This check proves schema/byte safety only; signer, current DB lineage,
 * original MDB file, target mapping and professional approvals are separate.
 */
export function parseF3UnverifiedDigestManifest(
  value:unknown,organizationId:string,
):F3LegacyExtractionManifest{
  if(!object(value)||!exact(value,[
    "format","status","organizationId","sourceSha256","digestKeyId",
    "tableCount","rowCount","tables","rows","sourceBytesVerified",
    "crossInstallationMappingApproved","realLegacyParityVerified",
    "clinicalFinanceApproved","operationalReady",
  ])||value.format!=="F3_LEGACY_SOURCE_FINGERPRINT_V1"||
     value.status!=="SYNTHETIC_OR_OFFLINE_EXTRACT_UNVERIFIED"||
     !UUID.test(organizationId)||value.organizationId!==organizationId||
     typeof value.sourceSha256!=="string"||!SHA.test(value.sourceSha256)||
     typeof value.digestKeyId!=="string"||!SHA.test(value.digestKeyId)||
     value.sourceBytesVerified!==false||
     value.crossInstallationMappingApproved!==false||
     value.realLegacyParityVerified!==false||
     value.clinicalFinanceApproved!==false||value.operationalReady!==false||
     value.tableCount!==ALLOWED.size||
     !Number.isSafeInteger(value.rowCount)|| (value.rowCount as number)<0||
     (value.rowCount as number)>20000||
     !Array.isArray(value.tables)||value.tables.length!==ALLOWED.size||
     !Array.isArray(value.rows)||value.rows.length!==value.rowCount)
    throw Error("f3_manifest_unverified_shape");
  const tables=new Set<string>();
  const declared=new Map<string,{
    schema:string;count:number;duplicates:number;
    observed:number;occurrences:Map<string,Set<number>>;
  }>();
  for(const t of value.tables){
    if(!object(t)||!exact(t,["sourceTable","sourceSchemaSha256",
      "rows","duplicateContentRows"])||
       typeof t.sourceTable!=="string"||
       !ALLOWED.has(t.sourceTable)||tables.has(t.sourceTable)||
       typeof t.sourceSchemaSha256!=="string"||
       !SHA.test(t.sourceSchemaSha256)||
       !Number.isSafeInteger(t.rows)||(t.rows as number)<0||
       !Number.isSafeInteger(t.duplicateContentRows)||
       (t.duplicateContentRows as number)<0||
       (t.duplicateContentRows as number)>(t.rows as number))
      throw Error("f3_manifest_unverified_table");
    tables.add(t.sourceTable);
    declared.set(t.sourceTable,{
      schema:t.sourceSchemaSha256,count:t.rows as number,
      duplicates:t.duplicateContentRows as number,
      observed:0,occurrences:new Map(),
    });
  }
  for(const row of value.rows){
    if(!object(row)||!exact(row,[
      "sourceTable","sourceSchemaSha256","rowDigest","occurrence",
    ])||typeof row.sourceTable!=="string"||
       !tables.has(row.sourceTable)||
       typeof row.sourceSchemaSha256!=="string"||
       !SHA.test(row.sourceSchemaSha256)||
       typeof row.rowDigest!=="string"||!SHA.test(row.rowDigest)||
       !Number.isSafeInteger(row.occurrence)||
       (row.occurrence as number)<1)
      throw Error("f3_manifest_unverified_row");
    const table=declared.get(row.sourceTable);
    const occurrence=row.occurrence as number;
    if(!table||row.sourceSchemaSha256!==table.schema||
       occurrence>table.count)
      throw Error("f3_manifest_unverified_schema_or_occurrence");
    const seen=table.occurrences.get(row.rowDigest)??new Set<number>();
    if(seen.has(occurrence))
      throw Error("f3_manifest_unverified_duplicate_row");
    seen.add(occurrence);
    table.occurrences.set(row.rowDigest,seen);
    table.observed++;
  }
  let declaredTotal=0;
  for(const table of declared.values()){
    declaredTotal+=table.count;
    if(table.observed!==table.count||
       table.count-table.occurrences.size!==table.duplicates)
      throw Error("f3_manifest_unverified_table_parity");
    for(const ordinals of table.occurrences.values()){
      // Repeated Access rows have contiguous 1..N occurrences.
      // A digest-only submission must not create phantom or missing rows.
      for(let n=1;n<=ordinals.size;n++){
        if(!ordinals.has(n))
          throw Error("f3_manifest_unverified_occurrence_gap");
      }
    }
  }
  if(declaredTotal!==value.rowCount)
    throw Error("f3_manifest_unverified_total_parity");
  return value as F3LegacyExtractionManifest;
}
