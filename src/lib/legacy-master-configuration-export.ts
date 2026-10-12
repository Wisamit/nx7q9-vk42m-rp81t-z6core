import { createHash } from "node:crypto";
import {
  LEGACY_MASTER_COLUMNS, LegacyMasterImportError, parseLegacyMasterCsv,
  type LegacyMasterKind,
} from "./legacy-master-data-import.ts";

export const legacyMasterPermissions: Record<LegacyMasterKind,string> = {
  REFERRER:"referrers.manage", SOURCE:"sources.manage",
  ORGANISM:"microbiology.manage", ANTIBIOTIC:"microbiology.manage",
  CLIENT:"clients.manage", COMMENT_TEMPLATE:"result_comments.manage",
};
export const legacyMasterExportKinds=Object.keys(legacyMasterPermissions) as LegacyMasterKind[];
export const LEGACY_EXPORT_CHUNK_SIZE=200;
export const LEGACY_EXPORT_MAX_ROWS=2000;
export const LEGACY_EXPORT_MAX_BYTES=4_000_000;

export class LegacyMasterExportError extends Error {
  readonly reason:string;
  readonly statusCode:number;
  constructor(reason:string,statusCode=422){super(reason);this.reason=reason;this.statusCode=statusCode;}
}
export type LegacyMasterExportRow={
  id:string;
  status:string;
  values:Record<string,string|null>;
};
export type MasterCsvChunk={
  partNumber:number; rowCount:number; firstCode:string; lastCode:string;
  sha256:string; csv:string;
  sourceRecords:Array<{id:string;code:string;status:string}>;
};
export function parseMasterExportKind(value:string|null):LegacyMasterKind|null {
  return typeof value==="string" && Object.hasOwn(legacyMasterPermissions,value)
    ? value as LegacyMasterKind : null;
}
export function csvCell(value:string|null|undefined):string {
  const text=value??"";
  // Fail closed on spreadsheet formulas instead of altering medically significant
  // text (which would make exported configuration non-round-trippable).
  if(text!==text.trim() || /^[=+\-@\t\r]/.test(text) ||
     /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text))
    throw new LegacyMasterExportError("unsafe_or_non_roundtrippable_csv_field");
  return /[",\r\n]/.test(text) ? '"'+text.replace(/"/g,'""')+'"' : text;
}
export function buildMasterCsv(kind:LegacyMasterKind, rows:readonly LegacyMasterExportRow[]):string {
  const headers=LEGACY_MASTER_COLUMNS[kind];
  const csv=[headers.join(","),...rows.map(row=>headers.map(h=>csvCell(row.values[h])).join(","))].join("\r\n")+"\r\n";
  try {
    // Exported CSV is guaranteed to be understood by the existing Stage 82-84
    // dry-run parser, including quoted/multiline clinical comments.
    if(rows.length>0){
      const parsed=parseLegacyMasterCsv(kind,csv);
      if(parsed.length!==rows.length)throw new LegacyMasterExportError("export_roundtrip_row_count_mismatch");
      for(let i=0;i<rows.length;i++){
        if(parsed[i].code!==rows[i].values.code ||
           parsed[i].nameEn!==rows[i].values.name_en ||
           (parsed[i].nameAr||"")!==(rows[i].values.name_ar||""))
          throw new LegacyMasterExportError("export_roundtrip_content_mismatch");
      }
    }
  } catch(e) {
    if(e instanceof LegacyMasterExportError)throw e;
    if(e instanceof LegacyMasterImportError)
      throw new LegacyMasterExportError("export_not_import_compatible_"+e.reason);
    throw e;
  }
  return csv;
}
export function masterExportChunks(kind:LegacyMasterKind, rows:readonly LegacyMasterExportRow[]):MasterCsvChunk[]{
  if(rows.length>LEGACY_EXPORT_MAX_ROWS)
    throw new LegacyMasterExportError("export_too_many_rows_no_truncation",413);
  const chunks:MasterCsvChunk[]=[];
  for(let i=0;i<rows.length;i+=LEGACY_EXPORT_CHUNK_SIZE){
    const batch=rows.slice(i,i+LEGACY_EXPORT_CHUNK_SIZE);
    const csv=buildMasterCsv(kind,batch);
    chunks.push({
      partNumber:chunks.length+1,rowCount:batch.length,
      firstCode:batch[0].values.code||"",lastCode:batch[batch.length-1].values.code||"",
      sha256:createHash("sha256").update(csv,"utf8").digest("hex"),csv,
      sourceRecords:batch.map(r=>({id:r.id,code:r.values.code||"",status:r.status})),
    });
  }
  return chunks;
}
export function masterExportManifest(organizationId:string,kind:LegacyMasterKind,
 rows:readonly LegacyMasterExportRow[],exportedAt:string){
 const parts=masterExportChunks(kind,rows);
 const integritySha256=createHash("sha256").update(JSON.stringify({
   organizationId,kind,parts:parts.map(({partNumber,rowCount,sha256,sourceRecords})=>({
     partNumber,rowCount,sha256,sourceRecords,
   })),
 })).digest("hex");
 const manifest={
   format:"family-lab-legacy-master-configuration-export",
   schemaVersion:1,organizationId,kind,exportedAt,
   consistency:"transactional-repeatable-read",
   scope:"TENANT_ONLY_ROLE_GATED_ACTIVE_MASTERS",
   importMode:"MANUAL_PREVIEW_REQUIRED_NO_AUTOMATIC_APPLY",
   warnings:[
    "This is not a database backup or a replacement for clinical, financial or audit history.",
    "CSV import always creates new masters only; existing destination codes reject.",
    "Clinical comment templates are imported INACTIVE and require separate clinical governance.",
    "Inactive source records are excluded; no prices, contracts, balances or patient data are exported.",
    "Referrer-client associations and comment-review/revision status are evidence only, not automatically restored.",
    "CSV is UTF-8; review before opening untrusted CSV in spreadsheet applications.",
   ],
   totalRows:rows.length,partCount:parts.length,
   integritySha256,parts,
 };
 if(Buffer.byteLength(JSON.stringify(manifest),"utf8")>LEGACY_EXPORT_MAX_BYTES)
   throw new LegacyMasterExportError("export_too_large_no_truncation",413);
 return manifest;
}
