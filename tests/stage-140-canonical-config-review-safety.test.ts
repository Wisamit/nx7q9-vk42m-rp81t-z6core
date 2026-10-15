import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import {
  canonicalStagingCsvFromAtomicGroup, CanonicalSpreadsheetReviewError,
  supportsCanonicalSpreadsheetReview,
} from "../src/lib/catalog-canonical-review-spreadsheet.ts";
import { parseCsvReviewFile } from "../src/lib/catalog-review-csv-import.ts";
import { catalogReviewXlsx } from "../src/lib/catalog-review-xlsx.ts";
import { xlsxReviewToCsv } from "../src/lib/catalog-review-xlsx-import.ts";
import { normalizeImportRow, validateImportRow, allowedImportEntities, rowValidationStatus } from "../src/lib/catalog-import.ts";

const id=randomUUID(),branch=randomUUID(),day="2026-10-15T00:00:00.000Z";
const sourceBase={id,status:"ACTIVE",code:"TEST_A",nameEn:"Complete blood count",nameAr:"تعداد الدم"};
const money={id,status:"ACTIVE",unitPrice:"1234.0123",effectiveFrom:day,effectiveTo:null};
const rows={
  TEST:sourceBase,
  UNIT:{id,status:"ACTIVE",code:"MG",nameEn:"milligram",nameAr:"ملغ",symbol:"mg"},
  CONTAINER:{id,status:"ACTIVE",code:"EDTA",nameEn:"EDTA tube",nameAr:"أنبوب",tubeColor:"Purple",additive:"EDTA"},
  COMPONENT:{...sourceBase,code:"HGB",test:{code:"CBC"},unit:{code:"G_DL"},resultType:"NUMERIC"},
  PANEL:{...sourceBase,code:"PANEL_A",items:[{test:{code:"CBC"}},{test:{code:"ESR"}}]},
  PACKAGE:{...sourceBase,code:"PACKAGE_A",items:[{test:{code:"CBC"}}]},
  PRICE_LIST:{...sourceBase,code:"AED_A",scopeType:"BRANCH",branchId:branch,
    currency:"AED",priority:5,effectiveFrom:day,effectiveTo:null,
    sourceId:null,referrerId:null,clientId:null,contractId:null},
  PRICE_LIST_ITEM:{...money,priceList:{code:"AED_A"},test:{code:"CBC"}},
  PRICE_LIST_PACKAGE_ITEM:{...money,priceList:{code:"AED_A"},package:{code:"PACKAGE_A"}},
} as const;

test("Stage 140: nine canonical groups are re-importable as review-only CSV and XLSX without inferred values",()=>{
  for(const [type,record] of Object.entries(rows)){
    assert.equal(supportsCanonicalSpreadsheetReview(type as keyof typeof rows),true,type);
    const csv=canonicalStagingCsvFromAtomicGroup({
      entityType:type as keyof typeof rows,records:[record],
    });
    for(const raw of [csv,xlsxReviewToCsv(catalogReviewXlsx(csv))]){
      const staged=parseCsvReviewFile(raw);
      assert.equal(staged.length,1,type);
      assert.equal(staged[0].legacyKey,id,type+" original immutable ID is retained as source lineage");
      assert.equal(staged[0].entityType,type);
      const normalized=normalizeImportRow(staged[0]);
      assert.notEqual(rowValidationStatus(validateImportRow(staged[0].entityType,normalized)),"ERROR",type);
      if(type==="PRICE_LIST") {
        assert.equal(normalized.branchId,branch);
        assert.equal(normalized.currency,"AED");
        assert.equal(normalized.effectiveFrom,"2026-10-15");
      }
      if(type.endsWith("_ITEM"))assert.equal(normalized.unitPrice,"1234.0123");
      if(type==="PANEL"||type==="PACKAGE")assert.deepEqual(normalized.memberTestCodes,
        type==="PANEL"?["CBC","ESR"]:["CBC"]);
      if(type==="COMPONENT")assert.equal(normalized.testCode,"CBC");
    }
  }
  assert.equal(allowedImportEntities.has("PRICE_LIST"),false);
  assert.equal(supportsCanonicalSpreadsheetReview("REFERENCE_INTERVAL"),false);
});

test("Stage 140: refuse ambiguous clinical/financial exports; do not silently lose source meaning",()=>{
  const cases:Array<[string,unknown,string]>=[
    ["REFERENCE_INTERVAL",sourceBase,"canonical_mapping_requires_professional_review"],
    ["TEST",{...sourceBase,status:"INACTIVE"},"canonical_inactive_source_requires_manual_review"],
    ["TEST",{...sourceBase,nameEn:"=IMPORTXML(1)"},"canonical_spreadsheet_formula_like_value"],
    ["TEST",{...sourceBase,id:"not-uuid"},"canonical_missing_source_identity"],
    ["PANEL",{...sourceBase,items:[{test:{code:"CBC"}},{test:{code:"CBC"}}]},"canonical_membership_duplicate"],
    ["PACKAGE",{...sourceBase,items:[]},"canonical_membership_missing"],
    ["COMPONENT",{...sourceBase,test:null,code:"HGB",resultType:"NUMERIC"},"canonical_source_record_invalid"],
    ["PRICE_LIST",{...rows.PRICE_LIST,contractId:randomUUID()},"canonical_contract_price_list_not_supported"],
    ["PRICE_LIST",{...rows.PRICE_LIST,scopeType:"CLIENT"},"canonical_contract_price_list_not_supported"],
    ["PRICE_LIST",{...rows.PRICE_LIST,effectiveFrom:"2026-10-15T08:30:00.000Z"},"canonical_price_list_local_date_ambiguous"],
    ["PRICE_LIST_ITEM",{...rows.PRICE_LIST_ITEM,unitPrice:18.001234},"canonical_non_exact_number:unitPrice"],
    ["PRICE_LIST_ITEM",{...rows.PRICE_LIST_ITEM,effectiveFrom:"10/15/2026"},"canonical_source_date_ambiguous:effectiveFrom"],
    ["UNIT",{...rows.UNIT,symbol:""},"canonical_source_requires_manual_mapping:UNIT_SYMBOL_REQUIRED"],
  ];
  for(const [type,record,reason] of cases){
    assert.throws(()=>canonicalStagingCsvFromAtomicGroup({entityType:type as keyof typeof rows,records:[record]}),
      (error:unknown)=>error instanceof CanonicalSpreadsheetReviewError && error.code===reason,
      type+" should reject "+reason);
  }
  assert.throws(()=>canonicalStagingCsvFromAtomicGroup({entityType:"UNIT",records:[]}),
    (e:unknown)=>e instanceof CanonicalSpreadsheetReviewError&&e.code==="canonical_row_limit");
});

test("Stage 140: UI obtains current scoped atomic bundle, has separate review-ready buttons and old exports remain",()=>{
  const ui=readFileSync("src/components/catalog-configuration-export.tsx","utf8");
  assert.match(ui,/async function downloadStaging/);
  assert.match(ui,/configuration-export\/bundle\?types=/);
  assert.match(ui,/transactional-consistent-read/);
  assert.match(ui,/canonicalStagingCsvFromAtomicGroup/);
  assert.match(ui,/downloadStaging\("csv"\)/);
  assert.match(ui,/downloadStaging\("xlsx"\)/);
  assert.match(ui,/download\("json"\)/);
  assert.match(ui,/download\("csv"\)/);
  assert.match(ui,/download\("xlsx"\)/);
  const stage=readFileSync("src/app/api/catalog/imports/csv/route.ts","utf8");
  assert.match(stage,/status: "DRAFT", validatedAt: null/);
  for(const route of ["src/app/api/catalog/imports/[id]/commit/route.ts",
    "src/app/api/catalog/imports/[id]/revalidate/route.ts"]){
    assert.match(readFileSync(route,"utf8"),/batch.sourceType === "CSV_REVIEW"/);
  }
});
