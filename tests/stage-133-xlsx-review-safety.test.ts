import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { catalogReviewXlsx, parseReviewCsvCells, XlsxReviewError } from "../src/lib/catalog-review-xlsx.ts";
import { xlsxReviewToCsv, XlsxStagingError } from "../src/lib/catalog-review-xlsx-import.ts";
import { parseCsvReviewFile, CsvStagingError } from "../src/lib/catalog-review-csv-import.ts";

const fields="entityType,legacyKey,testCode,code,nameEn,nameAr,unitCode,resultType,priceListCode,unitPrice,effectiveFrom,effectiveTo";
const example=[
  fields,
  'COMPONENT,C-133,GLU,GLUC,"Fasting, glucose",الغلوكوز,MGDL,NUMERIC,,,,',
  'PRICE_LIST_ITEM,P-133,GLU,,,,,,BASE_AED,123.4500,2026-10-15,',
].join("\r\n")+"\r\n";
function crc32(bytes:Uint8Array):number{
  let crc=0xffffffff;
  for(const b of bytes){crc^=b;for(let i=0;i<8;i++)crc=(crc>>>1)^(0xedb88320&-(crc&1));}
  return (crc^0xffffffff)>>>0;
}
function mutateStoredSheet(input:Uint8Array, from:string, to:string):Uint8Array{
  assert.equal(from.length,to.length);
  const bytes=Buffer.from(input);
  const localLabel=Buffer.from("xl/worksheets/sheet1.xml");
  let central=-1;
  for(let i=0;i<bytes.length-46-localLabel.length;i++){
    if(bytes.readUInt32LE(i)===0x02014b50&&bytes.subarray(i+46,i+46+localLabel.length).equals(localLabel)){
      central=i;break;
    }
  }
  assert.ok(central>=0);
  const offset=bytes.readUInt32LE(central+42);
  const start=offset+30+bytes.readUInt16LE(offset+26)+bytes.readUInt16LE(offset+28);
  const size=bytes.readUInt32LE(central+24);
  const sheet=bytes.subarray(start,start+size);
  const position=sheet.indexOf(from);
  assert.ok(position>=0);
  sheet.write(to,position,"utf8");
  const digest=crc32(sheet);
  bytes.writeUInt32LE(digest,offset+14);
  bytes.writeUInt32LE(digest,central+16);
  return bytes;
}

test("Stage 133: XLSX is native OOXML ZIP, Arabic and exact tariff lexemes roundtrip to strict CSV review",()=>{
  const bytes=catalogReviewXlsx("\uFEFF"+example);
  assert.equal(Buffer.from(bytes).subarray(0,4).toString("hex"),"504b0304");
  const canonical=xlsxReviewToCsv(bytes);
  const rows=parseCsvReviewFile(canonical);
  assert.equal(rows.length,2);
  assert.equal(rows[0].entityType,"COMPONENT");
  assert.equal(rows[0].data.nameAr,"الغلوكوز");
  assert.equal(rows[0].data.nameEn,"Fasting, glucose");
  assert.equal(rows[1].entityType,"PRICE_LIST_ITEM");
  assert.equal(rows[1].data.unitPrice,"123.4500");
  assert.equal(rows[1].data.effectiveFrom,"2026-10-15");
  assert.deepEqual(parseReviewCsvCells('a,b\r\n"q,r","x""y"\r\n'),[["a","b"],["q,r",'x"y']]);
});
test("Stage 133: formulas never execute, escaped entities decode and spreadsheet stored <f> is rejected",()=>{
  const csv=fields+"\r\nCOMPONENT,C-1,GLU,GLUC,=HYPERLINK(1),A&B,MGDL,NUMERIC,,,,\r\n";
  const output=xlsxReviewToCsv(catalogReviewXlsx(csv));
  const rows=parseCsvReviewFile(output);
  assert.equal(rows[0].data.nameEn,"=HYPERLINK(1)");
  assert.equal(rows[0].data.nameAr,"A&B");
  const poisoned=mutateStoredSheet(catalogReviewXlsx(example),'<t xml:space="preserve">','<f xml:space="preserve">');
  assert.throws(()=>xlsxReviewToCsv(poisoned),(e:unknown)=>e instanceof XlsxStagingError&&e.reason==="xlsx_formulas_or_merged_cells_forbidden");
});
test("Stage 133: file CRC, wrong payload, oversized upload and malformed CSV fail closed",()=>{
  const bytes=catalogReviewXlsx(example);
  const corrupt=new Uint8Array(bytes);
  corrupt[corrupt.length-40]^=0xff;
  assert.throws(()=>xlsxReviewToCsv(corrupt),XlsxStagingError);
  assert.throws(()=>xlsxReviewToCsv(new Uint8Array(20)),XlsxStagingError);
  assert.throws(()=>xlsxReviewToCsv(new Uint8Array(2*1024*1024+1)),XlsxStagingError);
  assert.throws(()=>parseReviewCsvCells('entityType,legacyKey\r\n"COMPONENT,Broken'),XlsxReviewError);
});
test("Stage 133: end-point and UI keep the approved CSV_REVIEW DRAFT gate, unchanged finance/clinical grants",()=>{
  const route=readFileSync("src/app/api/catalog/imports/csv/route.ts","utf8");
  const importUi=readFileSync("src/components/catalog-csv-review-staging.tsx","utf8");
  const exportUi=readFileSync("src/components/catalog-configuration-export.tsx","utf8");
  assert.match(route,/xlsxReviewToCsv\(rawUpload\)/);
  assert.match(route,/sourceType: "CSV_REVIEW"/);
  assert.match(route,/status: "DRAFT", validatedAt: null/);
  assert.match(route,/CATALOG_XLSX_REVIEW_STAGED/);
  assert.match(route,/pricing\.manage/);
  assert.match(route,/catalog\.reference_ranges\.manage/);
  assert.match(importUi,/accept="\.csv,\.xlsx/);
  assert.match(exportUi,/catalogReviewXlsx\(csvText\)/);
  assert.match(exportUi,/download\("xlsx"\)/);
});
