import {createHash,createHmac} from "node:crypto";
import {canonicalJson,type Json} from "./catalog-bundle-attestation.ts";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA=/^[a-f0-9]{64}$/;
const SAFE_NAME=/^[A-Za-z][A-Za-z0-9 _.-]{0,79}$/;
const PURPOSE="family-lab/f3-access-source-row-evidence/v1\n";
const FORBIDDEN=new Set([
  "password","id","id2","idprice","result","profnam",
]);
export const F3_LEGACY_MAX_TABLES=15;
export const F3_LEGACY_MAX_ROWS=20000;
export type F3LegacyTable={
  name:string;
  columns:readonly {name:string;accessType:string}[];
  rows:readonly Record<string,Json>[];
};
export type F3LegacySourceManifestInput={
  organizationId:string;
  sourceSha256:string;
  digestKeyId:string;
  tables:readonly F3LegacyTable[];
};
export type F3LegacyRowEvidence={
  sourceTable:string;sourceSchemaSha256:string;
  rowDigest:string;occurrence:number;
};
export type F3LegacyTableEvidence={
  sourceTable:string;sourceSchemaSha256:string;rows:number;
  duplicateContentRows:number;
};
export type F3LegacyExtractionManifest={
  format:"F3_LEGACY_SOURCE_FINGERPRINT_V1";
  status:"SYNTHETIC_OR_OFFLINE_EXTRACT_UNVERIFIED";
  organizationId:string;sourceSha256:string;digestKeyId:string;
  tableCount:number;rowCount:number;
  tables:readonly F3LegacyTableEvidence[];
  rows:readonly F3LegacyRowEvidence[];
  sourceBytesVerified:false;
  crossInstallationMappingApproved:false;
  realLegacyParityVerified:false;
  clinicalFinanceApproved:false;
  operationalReady:false;
};
const object=(v:unknown):v is Record<string,unknown> =>
  v!==null && typeof v==="object"&&!Array.isArray(v);
function safeName(value:unknown):value is string {
  return typeof value==="string"&&SAFE_NAME.test(value)&&
    !value.endsWith(" ")&&!value.startsWith(" ");
}
function validRecord(row:unknown,columns:readonly string[]):row is Record<string,Json>{
  if(!object(row)||Object.getPrototypeOf(row)!==Object.prototype ||
     Object.keys(row).length!==columns.length)return false;
  const expected=new Set(columns);
  if(Object.keys(row).some(key=>!expected.has(key)))return false;
  try{canonicalJson(row as Json);return true;}catch{return false;}
}

/**
 * Build privacy-preserving row-level HMAC replay evidence from a bounded,
 * pre-extracted in-memory fixture. Source bytes/ACE provenance are a separate
 * trust gate: a caller-supplied SHA is NOT evidence that an MDB was read.
 *
 * Sorting content digests and assigning per-identical-row occurrences avoids
 * depending on undefined Access physical row order or guessed primary keys.
 * This result fits LegacyCatalogRowLineage's sourceTable/schemaSha256/
 * digestKeyId/rowDigest/occurrence fields WITHOUT importing any patient rows.
 */
export function buildF3LegacyExtractionManifest(
  input:F3LegacySourceManifestInput,secret:string,
):F3LegacyExtractionManifest {
  if(!object(input)||Object.keys(input).sort().join(",")!==
       "digestKeyId,organizationId,sourceSha256,tables"||
     !UUID.test(input.organizationId)||!SHA.test(input.sourceSha256)||
     !SHA.test(input.digestKeyId)||
     typeof secret!=="string"||Buffer.byteLength(secret,"utf8")<32||
     !Array.isArray(input.tables)||input.tables.length<1||
     input.tables.length>F3_LEGACY_MAX_TABLES)
    throw Error("f3_source_manifest_invalid_header");
  let total=0;
  const seen=new Set<string>();
  const tables:F3LegacyTableEvidence[]=[];
  const rows:F3LegacyRowEvidence[]=[];
  for(const table of input.tables){
    if(!object(table)||Object.keys(table).sort().join(",")!=="columns,name,rows"||
       !safeName(table.name)||
       FORBIDDEN.has(table.name.toLowerCase())||
       seen.has(table.name.toLowerCase())||
       !Array.isArray(table.columns)||table.columns.length<1||
       table.columns.length>150||!Array.isArray(table.rows))
      throw Error("f3_source_manifest_invalid_table");
    seen.add(table.name.toLowerCase());
    const named=new Set<string>();
    for(const col of table.columns){
      if(!object(col)||Object.keys(col).sort().join(",")!=="accessType,name"||
         !safeName(col.name)||
         typeof col.accessType!=="string"||
         !/^[A-Za-z][A-Za-z0-9 ()_-]{0,63}$/.test(col.accessType)||
         named.has(col.name.toLowerCase()))
        throw Error("f3_source_manifest_invalid_column");
      named.add(col.name.toLowerCase());
    }
    total+=table.rows.length;
    if(total>F3_LEGACY_MAX_ROWS)throw Error("f3_source_manifest_too_many_rows");
    const schema=table.columns.map(col=>[col.name,col.accessType]);
    const sourceSchemaSha256=createHash("sha256")
      .update(canonicalJson(schema as Json)).digest("hex");
    const occurrence=new Map<string,number>();
    const contentHashes:string[]=[];
    const fields=table.columns.map(col=>col.name);
    for(const record of table.rows){
      if(!validRecord(record,fields))
        throw Error("f3_source_manifest_invalid_row_columns");
      const canonical=canonicalJson(record as Json);
      if(Buffer.byteLength(canonical,"utf8")>65536)
        throw Error("f3_source_manifest_row_too_large");
      const digest=createHmac("sha256",secret).update(PURPOSE)
        .update(canonicalJson([
          input.organizationId,input.sourceSha256,input.digestKeyId,table.name,
          sourceSchemaSha256,canonical,
        ] as Json)).digest("hex");
      contentHashes.push(digest);
    }
    contentHashes.sort();
    for(const hash of contentHashes){
      const next=(occurrence.get(hash)||0)+1;
      occurrence.set(hash,next);
      rows.push({sourceTable:table.name,sourceSchemaSha256,
        rowDigest:hash,occurrence:next});
    }
    tables.push({sourceTable:table.name,sourceSchemaSha256,
      rows:table.rows.length,duplicateContentRows:
        table.rows.length-occurrence.size});
  }
  // A digest-only manifest can be archived/reconciled without exposing names,
  // test values or patient content. Full 15-table coverage is checked by the
  // higher-level F3 reconciliation; no table name is fabricated here.
  tables.sort((a,b)=>a.sourceTable.toLowerCase().localeCompare(b.sourceTable.toLowerCase()));
  rows.sort((a,b)=>a.sourceTable.toLowerCase().localeCompare(b.sourceTable.toLowerCase())||
    a.rowDigest.localeCompare(b.rowDigest)||a.occurrence-b.occurrence);
  return {
    format:"F3_LEGACY_SOURCE_FINGERPRINT_V1",
    status:"SYNTHETIC_OR_OFFLINE_EXTRACT_UNVERIFIED",
    organizationId:input.organizationId,
    sourceSha256:input.sourceSha256,digestKeyId:input.digestKeyId,
    tableCount:tables.length,rowCount:total,tables,rows,
    sourceBytesVerified:false,crossInstallationMappingApproved:false,
    realLegacyParityVerified:false,clinicalFinanceApproved:false,
    operationalReady:false,
  };
}
