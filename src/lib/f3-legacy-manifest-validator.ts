import {LEGACY_COVERAGE_SOURCES} from "./legacy-source-coverage.ts";
import type {F3LegacyExtractionManifest}
  from "./f3-legacy-extraction-manifest.ts";

const SHA=/^[a-f0-9]{64}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
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
  }
  return value as F3LegacyExtractionManifest;
}
