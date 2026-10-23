import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { canonicalStagingCsvFromAtomicGroup, CanonicalSpreadsheetReviewError } from "../src/lib/catalog-canonical-review-spreadsheet.ts";
import { parseCsvReviewFile } from "../src/lib/catalog-review-csv-import.ts";
import { catalogReviewXlsx } from "../src/lib/catalog-review-xlsx.ts";
import { xlsxReviewToCsv } from "../src/lib/catalog-review-xlsx-import.ts";
import { normalizeImportRow, rowValidationStatus, validateImportRow } from "../src/lib/catalog-import.ts";
import { validateExpandedCsvReviewRow } from "../src/lib/catalog-expanded-csv-review.ts";
import { csvReviewBatchConflictIssues, csvReviewTariffRowIssues } from "../src/lib/catalog-csv-review-integrity.ts";

const id = () => randomUUID();
const day = "2026-10-23T00:00:00.000Z";
function expectCode(fn:()=>unknown, expected:string) {
  assert.throws(fn,(error:unknown)=>error instanceof CanonicalSpreadsheetReviewError &&
    error.code === expected,expected);
}
function readBoth(type:"UNIT"|"CONTAINER",data:unknown) {
  const csv=canonicalStagingCsvFromAtomicGroup({entityType:type,records:[data]});
  return [parseCsvReviewFile(csv),parseCsvReviewFile(xlsxReviewToCsv(catalogReviewXlsx(csv)))];
}
const unit=()=>({id:id(),code:"MGDL",nameEn:"Milligrams per deciliter",
  nameAr:"ملغ لكل ديسيلتر",symbol:"mg/dL",ucumCode:"mg/dL",status:"ACTIVE"});
const container=()=>({id:id(),code:"EDTA",nameEn:"EDTA tube",
  nameAr:"أنبوب بنفسجي",tubeColor:"Purple",additive:"K2 EDTA",status:"ACTIVE"});

test("F8 §87: container bilingual identity, tube color and additive roundtrip CSV and XLSX verbatim",()=>{
  const source=container();
  for (const [entry] of readBoth("CONTAINER",source)){
    assert.equal(entry.legacyKey,source.id);
    assert.equal(entry.data.nameAr,source.nameAr);
    assert.equal(entry.data.tubeColor,source.tubeColor);
    assert.equal(entry.data.additive,source.additive);
    const n=normalizeImportRow(entry);
    assert.deepEqual(n,{code:"EDTA",nameEn:"EDTA tube",nameAr:"أنبوب بنفسجي",
      tubeColor:"Purple",additive:"K2 EDTA"});
    assert.equal(rowValidationStatus([...validateImportRow(entry.entityType,n),
      ...validateExpandedCsvReviewRow(entry.entityType,n)]),"WARNING");
  }
  const source2={...source,id:id(),code:"LITHIUM",nameAr:null,tubeColor:null,additive:null};
  const nullable=readBoth("CONTAINER",source2)[0][0];
  assert.equal(nullable.data.nameAr,"");
  assert.equal(nullable.data.tubeColor,"");
  assert.equal(nullable.data.additive,"");
});

test("F8 §87: unit UCUM identity and Arabic labels stay explicit through both formats",()=>{
  const source=unit();
  for(const [entry] of readBoth("UNIT",source)){
    assert.equal(entry.data.ucumCode,"mg/dL");
    const n=normalizeImportRow(entry);
    assert.equal(n.ucumCode,"mg/dL");
    assert.equal(n.nameAr,source.nameAr);
    assert.equal(n.symbol,"mg/dL");
    assert.equal(rowValidationStatus([...validateImportRow(entry.entityType,n),
      ...validateExpandedCsvReviewRow(entry.entityType,n)]),"WARNING");
  }
  assert.equal(normalizeImportRow(parseCsvReviewFile(
    "entityType,code,symbol,ucumCode\nUNIT,MG,mg,mg\n")[0]).ucumCode,"mg");
});

test("F8 §87: field-size overflow cannot be disguised by the review-ready export",()=>{
  expectCode(()=>canonicalStagingCsvFromAtomicGroup({
    entityType:"UNIT",records:[{...unit(),ucumCode:"x".repeat(51)}]
  }),"canonical_source_requires_manual_mapping:UNIT_UCUM_FIELD_INVALID");
  expectCode(()=>canonicalStagingCsvFromAtomicGroup({
    entityType:"CONTAINER",records:[{...container(),tubeColor:"x".repeat(81)}]
  }),"canonical_source_requires_manual_mapping:CONTAINER_SOURCE_FIELDS_INVALID");
  expectCode(()=>canonicalStagingCsvFromAtomicGroup({
    entityType:"CONTAINER",records:[{...container(),additive:"x".repeat(151)}]
  }),"canonical_source_requires_manual_mapping:CONTAINER_SOURCE_FIELDS_INVALID");
  expectCode(()=>canonicalStagingCsvFromAtomicGroup({
    entityType:"CONTAINER",records:[{...container(),nameAr:"ع".repeat(151)}]
  }),"canonical_source_requires_manual_mapping:CONTAINER_SOURCE_FIELDS_INVALID");
});

test("F8 §87: normalization must not silently change source identity, codes or Arabic names",()=>{
  expectCode(()=>canonicalStagingCsvFromAtomicGroup({
    entityType:"CONTAINER",records:[{...container(),code:"edta"}]
  }),"canonical_normalization_not_lossless:code");
  expectCode(()=>canonicalStagingCsvFromAtomicGroup({
    entityType:"UNIT",records:[{...unit(),nameAr:"  وحدة القياس "}]
  }),"canonical_normalization_not_lossless:nameAr");
  expectCode(()=>canonicalStagingCsvFromAtomicGroup({
    entityType:"UNIT",records:[{...unit(),ucumCode:" mg/dL "}]
  }),"canonical_normalization_not_lossless:ucumCode");
  const one=container();
  expectCode(()=>canonicalStagingCsvFromAtomicGroup({
    entityType:"CONTAINER",records:[one,{...one,code:"SECOND"}]
  }),"canonical_duplicate_source_identity");
  expectCode(()=>canonicalStagingCsvFromAtomicGroup({
    entityType:"CONTAINER",records:[one,{...container(),code:one.code}]
  }),"canonical_source_requires_manual_mapping:CSV_DUPLICATE_STAGED_IDENTITY");
});

test("F8 §87 / §86: canonical exports cannot advertise an unstageable financial amount or window",()=>{
  const price=()=>({id:id(),status:"ACTIVE",unitPrice:"123.4500",
    effectiveFrom:day,effectiveTo:null,priceList:{
      code:"ORG_AED",scopeType:"ORGANIZATION",branchId:null,
      status:"ACTIVE",sourceId:null,referrerId:null,clientId:null,contractId:null,
    },test:{code:"CBC"}});
  expectCode(()=>canonicalStagingCsvFromAtomicGroup({entityType:"PRICE_LIST_ITEM",
    records:[{...price(),unitPrice:"100000000000000.0000"}]}),
    "canonical_source_requires_manual_mapping:CSV_TARIFF_DECIMAL_OUT_OF_RANGE");
  expectCode(()=>canonicalStagingCsvFromAtomicGroup({entityType:"PRICE_LIST_ITEM",
    records:[{...price(),effectiveTo:"2026-10-22T00:00:00.000Z"}]}),
    "canonical_source_requires_manual_mapping:INVALID_PRICE_EFFECTIVE_WINDOW,CSV_TARIFF_EFFECTIVE_WINDOW_INVALID");
  const good=price();
  const second={...price(),effectiveFrom:"2026-10-24T00:00:00.000Z"};
  const csv=canonicalStagingCsvFromAtomicGroup({
    entityType:"PRICE_LIST_ITEM",records:[good,second],
  });
  const entries=parseCsvReviewFile(csv);
  assert.equal(entries.length,2);
  const normalized=entries.map(x=>normalizeImportRow(x));
  assert.deepEqual(csvReviewBatchConflictIssues(entries.map((x,i)=>({
    entityType:x.entityType,normalized:normalized[i],
  }))),[[],[]]);
  assert.deepEqual(csvReviewTariffRowIssues(entries[0].entityType,normalized[0]),[]);
});

test("F8 §87: parity changes remain DRAFT-only and do not unlock legacy commit",()=>{
  const route=readFileSync("src/app/api/catalog/imports/csv/route.ts","utf8");
  const render=readFileSync("src/components/catalog-configuration-export.tsx","utf8");
  const code=readFileSync("src/lib/catalog-canonical-review-spreadsheet.ts","utf8");
  for(const word of ["catalog-review-csv-import.ts","csvReviewBatchConflictIssues",
    "csvReviewTariffRowIssues","canonical_normalization_not_lossless",
    "canonical_duplicate_source_identity"])assert.ok(code.includes(word),word);
  assert.ok(route.includes('sourceType: "CSV_REVIEW"'));
  assert.ok(route.includes('status: "DRAFT", validatedAt: null'));
  assert.ok(render.includes('canonicalStagingCsvFromAtomicGroup('));
  for(const action of ["commit","revalidate"]){
    assert.ok(readFileSync("src/app/api/catalog/imports/[id]/"+action+"/route.ts","utf8")
      .includes('batch.sourceType === "CSV_REVIEW"'));
  }
});
