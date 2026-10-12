import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID,createHash } from "node:crypto";
import {readFileSync} from "node:fs";
import {parseLegacyMasterCsv} from "../src/lib/legacy-master-data-import.ts";
import {
  csvCell,buildMasterCsv,masterExportChunks,masterExportManifest,
  parseMasterExportKind,legacyMasterPermissions,
  LegacyMasterExportError,LEGACY_EXPORT_MAX_ROWS,
} from "../src/lib/legacy-master-configuration-export.ts";

const row=(code:string,name="Standard master")=>({
  id:randomUUID(),status:"ACTIVE",values:{
    code,name_en:name,name_ar:"معمل العائلة",category:"WALK_IN",
  },
});
test("Stage 95: all six scoped types supported; arbitrary params rejected",()=>{
  for(const kind of ["REFERRER","SOURCE","ORGANISM","ANTIBIOTIC","CLIENT","COMMENT_TEMPLATE"]){
    assert.equal(parseMasterExportKind(kind),kind);
    assert.ok(legacyMasterPermissions[kind as keyof typeof legacyMasterPermissions].endsWith(".manage"));
  }
  for(const value of ["PATIENT","ORDERS","BALANCE","ALL","TEST",null,"__proto__"]){
    assert.equal(parseMasterExportKind(value),null);
  }
});
test("Stage 95: exact quoted CSV round-trips through existing staging parser",()=>{
  const source=[row("CLINIC01",'Dr "Quoted", with commas\nand a line break')];
  const csv=buildMasterCsv("SOURCE",source);
  const r=parseLegacyMasterCsv("SOURCE",csv);
  assert.equal(r[0].nameEn,source[0].values.name_en);
  assert.equal(r[0].nameAr,source[0].values.name_ar);
  assert.equal(r[0].category,"WALK_IN");
  assert.match(csv,/"Dr ""Quoted"", with commas/);
});
test("Stage 95: never mutate unsafe CSV formula cells or silently truncate",()=>{
  for(const v of ["=SUM(1,2)","+cmd","-3+5","@HYPERLINK"," starts","ends ","\tcmd"]){
    assert.throws(()=>csvCell(v),
      e=>e instanceof LegacyMasterExportError&&e.reason==="unsafe_or_non_roundtrippable_csv_field");
  }
  const batch=Array.from({length:201},(_,i)=>row("SRC"+String(i).padStart(4,"0")));
  const parts=masterExportChunks("SOURCE",batch);
  assert.deepEqual(parts.map(x=>x.rowCount),[200,1]);
  assert.ok(parts[0].csv.startsWith("code,name_en,name_ar,category"));
  assert.equal(parts[0].sha256,createHash("sha256").update(parts[0].csv).digest("hex"));
  const longClinicalTemplates=Array.from({length:40},(_,i)=>({
    id:randomUUID(),status:"ACTIVE",
    values:{code:"COMMENT"+String(i).padStart(3,"0"),name_en:"Comment "+i,
      name_ar:null,text_en:"A".repeat(4000),text_ar:null,
      scope:"ORGANIZATION",test_code:null,component_code:null},
  }));
  const clinicalParts=masterExportChunks("COMMENT_TEMPLATE",longClinicalTemplates);
  assert.ok(clinicalParts.length>1,"long clinical text must be split by byte size");
  assert.equal(clinicalParts.reduce((total,part)=>total+part.rowCount,0),40);
  for(const part of clinicalParts){
    assert.ok(Buffer.byteLength(part.csv,"utf8")<=65_536);
    assert.equal(parseLegacyMasterCsv("COMMENT_TEMPLATE",part.csv).length,part.rowCount);
  }
  assert.throws(()=>masterExportChunks("SOURCE",
    Array.from({length:LEGACY_EXPORT_MAX_ROWS+1},(_,i)=>row("S"+i))),
    e=>e instanceof LegacyMasterExportError&&e.statusCode===413);
});
test("Stage 95: manifest binds type, organization, exact chunks and provenance",()=>{
  const entries=[row("SRC01"),row("SRC02")];
  const stamp="2026-10-12T00:00:00.000Z";
  const a=masterExportManifest(randomUUID(),"SOURCE",entries,stamp);
  assert.equal(a.totalRows,2);
  assert.equal(a.partCount,1);
  assert.equal(a.parts[0].sourceRecords[0].id,entries[0].id);
  assert.equal(a.consistency,"transactional-repeatable-read");
  assert.equal(a.parts[0].csv.split("\r\n").length,4);
  const b=masterExportManifest(a.organizationId,"SOURCE",entries,stamp);
  assert.equal(a.integritySha256,b.integritySha256);
  assert.notEqual(a.integritySha256,masterExportManifest(a.organizationId,"SOURCE",
    [entries[1],entries[0]],stamp).integritySha256);
  assert.ok(a.warnings.some(x=>x.includes("NOT restored")||x.includes("not a database backup")));
  const empty=masterExportManifest(a.organizationId,"SOURCE",[],stamp);
  assert.equal(empty.totalRows,0);assert.deepEqual(empty.parts,[]);
});
test("Stage 95: explicit server-side authorization and audit; no balances or patient data",()=>{
  const api=readFileSync("src/app/api/legacy/master-data-export/route.ts","utf8");
  const ui=readFileSync("src/components/legacy-master-configuration-export.tsx","utf8");
  const page=readFileSync("src/app/catalog/legacy-master-data/page.tsx","utf8");
  assert.match(api,/permissions|permissionSet\(session\)/);
  assert.match(api,/legacyMasterPermissions\[kind\]/);
  assert.match(api,/item.branchId===branchId/);
  assert.match(api,/tx.userBranchScope.findUnique/);
  assert.match(api,/WHERE id=\$\{organizationId\} AND status='ACTIVE' FOR UPDATE/);
  assert.match(api,/status:"ACTIVE"/);
  assert.match(api,/tx.resultCommentTemplate.findMany/);
  assert.match(api,/tx.auditEvent.create/);
  assert.match(api,/LEGACY_MASTER_CONFIGURATION_EXPORTED/);
  assert.match(api,/isolationLevel:"RepeatableRead"/);
  assert.doesNotMatch(api,/tx.invoice|tx.patient|tx.payment|tx.refund|tx.creditNote/);
  assert.match(ui,/archive.parts.map/);
  assert.match(ui,/part.csv/);
  assert.match(page,/LegacyMasterConfigurationExport/);
});
