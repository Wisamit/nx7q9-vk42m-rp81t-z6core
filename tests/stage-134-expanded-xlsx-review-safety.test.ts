import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  parseCsvReviewFile, CsvStagingError, CSV_STAGE_MASTER_TEMPLATE_HEADERS,
  CSV_STAGE_PACKAGE_PRICE_TEMPLATE_HEADERS, CSV_REVIEW_ENTITY_TYPES,
} from "../src/lib/catalog-review-csv-import.ts";
import { catalogReviewXlsx } from "../src/lib/catalog-review-xlsx.ts";
import { xlsxReviewToCsv } from "../src/lib/catalog-review-xlsx-import.ts";
import { normalizeImportRow, validateImportRow, rowValidationStatus } from "../src/lib/catalog-import.ts";
import { validateExpandedCsvReviewRow } from "../src/lib/catalog-expanded-csv-review.ts";

function csvRow(headers: readonly string[], input: Record<string, string | undefined>): string {
  return headers.map(h => '"' + (input[h] || "").replace(/"/g, '""') + '"').join(",");
}
const master = CSV_STAGE_MASTER_TEMPLATE_HEADERS;
const values = [
  {entityType:"TEST",legacyKey:"old-test",code:"TSH",nameEn:"Thyroid Stimulating Hormone",nameAr:"هرمون الغدة"},
  {entityType:"UNIT",legacyKey:"old-unit",code:"MGDL",nameEn:"Milligrams per deciliter",symbol:"mg/dL"},
  {entityType:"PANEL",legacyKey:"old-panel",code:"THYROID_PANEL",nameEn:"Thyroid panel",memberTestCodes:'["TSH"]'},
  {entityType:"PACKAGE",legacyKey:"old-package",code:"THYROID_PKG",nameEn:"Thyroid package",memberTestCodes:'["TSH"]'},
  {entityType:"CONTAINER",legacyKey:"old-container",code:"SERUM_TUBE",nameEn:"Serum tube"},
];
const mastersCsv = master.join(",")+"\r\n"+values.map(v=>csvRow(master,v)).join("\r\n")+"\r\n";

test("Stage 134: all five additional master entities can be staged from CSV and native XLSX without activation", () => {
  const csvRows=parseCsvReviewFile(mastersCsv);
  const excelRows=parseCsvReviewFile(xlsxReviewToCsv(catalogReviewXlsx(mastersCsv)));
  assert.deepEqual(excelRows,csvRows);
  assert.deepEqual(csvRows.map(v=>v.entityType),["TEST","UNIT","PANEL","PACKAGE","CONTAINER"]);
  const normalized=csvRows.map(row=>normalizeImportRow(row));
  assert.equal(normalized[0].nameAr,"هرمون الغدة");
  assert.equal(normalized[1].symbol,"mg/dL");
  assert.deepEqual(normalized[2].memberTestCodes,["TSH"]);
  assert.deepEqual(normalized[3].memberTestCodes,["TSH"]);
  for(let i=0;i<csvRows.length;i++){
    const issues=[...validateImportRow(csvRows[i].entityType,normalized[i]),
      ...validateExpandedCsvReviewRow(csvRows[i].entityType,normalized[i])];
    assert.equal(rowValidationStatus(issues),"WARNING",csvRows[i].entityType);
    assert.ok(issues.some(x=>x.code.includes("REVIEW")||x.code.includes("APPROVAL")));
  }
  assert.ok(CSV_REVIEW_ENTITY_TYPES.has("PRICE_LIST_PACKAGE_ITEM"));
});

test("Stage 134: package prices retain exact DECIMAL and effective window through XLSX staging",()=>{
  const header=CSV_STAGE_PACKAGE_PRICE_TEMPLATE_HEADERS;
  const line=csvRow(header,{entityType:"PRICE_LIST_PACKAGE_ITEM",legacyKey:"old-package-tariff",
    priceListCode:"ORG_AED",packageCode:"THYROID_PKG",unitPrice:"123.4500",
    effectiveFrom:"2026-10-15",effectiveTo:"2027-10-14"});
  const rows=parseCsvReviewFile(xlsxReviewToCsv(catalogReviewXlsx(header.join(",")+"\r\n"+line+"\r\n")));
  assert.equal(rows.length,1);
  const candidate=normalizeImportRow(rows[0]);
  assert.deepEqual(candidate,{priceListCode:"ORG_AED",packageCode:"THYROID_PKG",
    unitPrice:"123.4500",effectiveFrom:"2026-10-15",effectiveTo:"2027-10-14"});
  const issues=validateImportRow(rows[0].entityType,candidate);
  assert.equal(rowValidationStatus(issues),"WARNING");
  assert.ok(issues.some(x=>x.code==="PACKAGE_TARIFF_APPROVAL_REQUIRED"));
});

test("Stage 134: missing/duplicate/invalid panel/package memberships are errors, never guessed",()=>{
  for(const entityType of ["PANEL","PACKAGE"]){
    for(const membership of ["","not-json",'["TSH","TSH"]','["TSH","@bad"]']){
      const line=csvRow(master,{entityType,code:"A",nameEn:"A",memberTestCodes:membership});
      const row=parseCsvReviewFile(master.join(",")+"\n"+line+"\n")[0];
      const normalized=normalizeImportRow(row);
      const issues=[...validateImportRow(row.entityType,normalized),
        ...validateExpandedCsvReviewRow(row.entityType,normalized)];
      assert.equal(rowValidationStatus(issues),"ERROR",entityType+":"+membership);
    }
  }
  assert.throws(()=>parseCsvReviewFile('entityType,code\nPRICE_LIST,TOP_SECRET\n'),CsvStagingError);
});

test("Stage 134: XLSX/CSV import stays DRAFT author-bound, finance grants include package prices",()=>{
  const route=readFileSync("src/app/api/catalog/imports/csv/route.ts","utf8");
  const page=readFileSync("src/app/catalog/imports/[id]/page.tsx","utf8");
  const ui=readFileSync("src/components/catalog-csv-review-staging.tsx","utf8");
  const commit=readFileSync("src/app/api/catalog/imports/[id]/commit/route.ts","utf8");
  const revalidate=readFileSync("src/app/api/catalog/imports/[id]/revalidate/route.ts","utf8");
  assert.match(route,/row.entityType === "PRICE_LIST_PACKAGE_ITEM"/);
  assert.match(route,/permissions.has\("pricing.manage"\)/);
  assert.match(route,/resolveClinicalImportScope/);
  assert.match(route,/sourceType: "CSV_REVIEW"/);
  assert.match(route,/status: "DRAFT", validatedAt: null/);
  assert.match(route,/CATALOG_XLSX_REVIEW_STAGED/);
  assert.match(page,/batch.createdByUserId !== session.user.id/);
  assert.match(page,/stagedOtherPrices > 0 && !permissions.has\("pricing.manage"\)/);
  assert.match(ui,/saveTemplate\("master", "xlsx"\)/);
  assert.match(ui,/saveTemplate\("package-price", "xlsx"\)/);
  assert.match(commit,/batch.sourceType === "CSV_REVIEW"/);
  assert.match(revalidate,/batch.sourceType === "CSV_REVIEW"/);
});
