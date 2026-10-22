import {createHash} from "node:crypto";
import {buildF3LegacyExtractionManifest,
  type F3LegacyTable,type F3LegacyExtractionManifest}
  from "./f3-legacy-extraction-manifest.ts";
import {LEGACY_COVERAGE_SOURCES} from "./legacy-source-coverage.ts";
import {
  LEGACY_ROW_LINEAGE_PAGE_SIZE,LEGACY_ROW_LINEAGE_TYPE,
  parseLegacyRowManifest,type LegacyRowManifest,
} from "./catalog-legacy-row-lineage.ts";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX=/^[a-f0-9]{64}$/;
const object=(v:unknown):v is Record<string,unknown> =>
  v!==null&&typeof v==="object"&&!Array.isArray(v);
const exact=(v:Record<string,unknown>,keys:readonly string[])=>
  Object.keys(v).sort().join(",") === [...keys].sort().join(",");
export type F3LegacyLocalExtract={
  format:"F3_ACE_OFFLINE_CONFIGURATION_EXTRACT_V1";
  sourceName:string;sourceSha256:string;sourceBytes:number;
  exportedAtUtc:string;
  sourceFileBytesHashedLocally:true;
  sourceIdentityExternallyAttested:false;
  migrated:false;
  tables:F3LegacyTable[];
};
export type F3LegacyStagingPages={
  manifest:F3LegacyExtractionManifest;
  pages:readonly LegacyRowManifest[];
  sourceLocalHashOnly:true;
  productionApproved:false;
};
/** A client-side/local source hash is not proof of third-party authorship. */
export function f3SourceDigestKeyId(secret:string):string{
  if(typeof secret!=="string"||Buffer.byteLength(secret,"utf8")<32)
    throw Error("f3_hmac_secret_unavailable");
  return createHash("sha256").update("family-lab/f3/offline-key-id/v1\n")
    .update(secret).digest("hex");
}
/**
 * Bridge the **local-only** read-only Windows ACE extract to the EXISTING
 * review-only /api/catalog/legacy-row-lineage staging protocol. Raw MDB rows
 * stay on the offline computer: exported pages contain only HMAC digest and
 * occurrence, source SHA, row counts and declared table names.
 *
 * This helper does not upload pages, approve mapping or import patient/result
 * data. Actual source independence remains an F8 operational gate.
 */
export function f3BuildLegacyReviewPages(input:{
  organizationId:string;extract:unknown;secret:string;
}):F3LegacyStagingPages{
  const {organizationId,extract,secret}=input;
  if(!UUID.test(organizationId)||!object(extract)||
     !exact(extract,["format","sourceName","sourceSha256","sourceBytes",
       "exportedAtUtc","sourceFileBytesHashedLocally",
       "sourceIdentityExternallyAttested","migrated","tables"])||
     extract.format!=="F3_ACE_OFFLINE_CONFIGURATION_EXTRACT_V1"||
     typeof extract.sourceName!=="string" ||
     !/^[^\\/\u0000-\u001f]{1,255}\.(?:mdb|accdb)$/i.test(extract.sourceName)||
     typeof extract.sourceSha256!=="string"||
     !HEX.test(extract.sourceSha256)||
     !Number.isSafeInteger(extract.sourceBytes)||
     (extract.sourceBytes as number)<1||
     (extract.sourceBytes as number)>1_000_000_000||
     typeof extract.exportedAtUtc!=="string"||
     !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(extract.exportedAtUtc)||
     !Number.isFinite(Date.parse(extract.exportedAtUtc))||
     extract.sourceFileBytesHashedLocally!==true||
     extract.sourceIdentityExternallyAttested!==false||
     extract.migrated!==false||!Array.isArray(extract.tables))
    throw Error("f3_offline_intake_invalid_extract");
  const digestKeyId=f3SourceDigestKeyId(secret);
  const manifest=buildF3LegacyExtractionManifest({
    organizationId,sourceSha256:extract.sourceSha256,
    digestKeyId,tables:extract.tables as F3LegacyTable[],
  },secret);
  // Staged HMACs MUST use the exact canonical case-sensitive table labels
  // of the existing legacy row-lineage protocol, not approximate names.
  for(const table of manifest.tables){
    if(!LEGACY_COVERAGE_SOURCES.some(source=>source.tableName===table.sourceTable))
      throw Error("f3_offline_intake_invalid_source_table");
  }
  const pages:LegacyRowManifest[]=[];
  for(const table of manifest.tables){
    const records=manifest.rows.filter(row=>row.sourceTable===table.sourceTable);
    const count=Math.max(1,Math.ceil(records.length/LEGACY_ROW_LINEAGE_PAGE_SIZE));
    for(let i=0;i<count;i++){
      const chunk=records.slice(i*LEGACY_ROW_LINEAGE_PAGE_SIZE,
        (i+1)*LEGACY_ROW_LINEAGE_PAGE_SIZE);
      const page:LegacyRowManifest={
        schemaVersion:1,evidenceType:LEGACY_ROW_LINEAGE_TYPE,
        sourceName:extract.sourceName,sourceSha256:manifest.sourceSha256,
        sourceBytes:extract.sourceBytes as number,
        tableName:table.sourceTable,
        schemaSha256:table.sourceSchemaSha256,
        digestKeyId,sourceRowCount:table.rows,
        chunkIndex:i,chunkCount:count,
        exportedAtUtc:extract.exportedAtUtc,includesPatientData:false,
        rows:chunk.map(row=>({rowDigest:row.rowDigest,
          occurrence:row.occurrence})),
      };
      // Internal acceptance uses the same strict parser as live import API.
      pages.push(parseLegacyRowManifest(page));
    }
  }
  return {manifest,pages,sourceLocalHashOnly:true,
    productionApproved:false};
}
