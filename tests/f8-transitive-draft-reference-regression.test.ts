import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spreadsheetReferenceFindings } from "../src/lib/catalog-csv-review-references.ts";
import { rowValidationStatus } from "../src/lib/catalog-import.ts";
import { parseCsvReviewFile } from "../src/lib/catalog-review-csv-import.ts";
import { normalizeImportRow } from "../src/lib/catalog-import.ts";
import { catalogReviewXlsx } from "../src/lib/catalog-review-xlsx.ts";
import { xlsxReviewToCsv } from "../src/lib/catalog-review-xlsx-import.ts";

const live = {
  tests: new Set(["VISIBLE_TEST"]), units: new Set<string>(),
  packages: new Set<string>(), priceLists: new Set(["VISIBLE_LIST"]),
};
const draft=(entityType:string,normalized:Record<string,unknown>,
  status:"VALID"|"WARNING"|"ERROR"="WARNING")=>({entityType,normalized,status});
const codes=(row:readonly {code:string}[])=>row.map(issue=>issue.code);

test("F8 §87: missing clinical test invalidates both staged package and its tariff",()=>{
  const rows=spreadsheetReferenceFindings([
    draft("PACKAGE",{code:"NEW_PKG",memberTestCodes:["FOREIGN_OR_INACTIVE_TEST"]}),
    draft("PRICE_LIST_PACKAGE_ITEM",{priceListCode:"VISIBLE_LIST",packageCode:"NEW_PKG"}),
  ],live);
  for (const row of rows) {
    assert.ok(codes(row).includes("CSV_REVIEW_REFERENCE_MISSING_OR_OUT_OF_SCOPE"));
    assert.equal(rowValidationStatus([...row]),"ERROR");
    assert.ok(!JSON.stringify(row).includes("FOREIGN_OR_INACTIVE_TEST"));
  }
});

test("F8 §87: fully visible staged package is review-pending, never live",()=>{
  const rows=spreadsheetReferenceFindings([
    draft("PACKAGE",{code:"NEW_PKG",memberTestCodes:["VISIBLE_TEST"]}),
    draft("PRICE_LIST_PACKAGE_ITEM",{priceListCode:"VISIBLE_LIST",packageCode:"NEW_PKG"}),
  ],live);
  assert.deepEqual(rows[0],[]);
  assert.deepEqual(codes(rows[1]),["CSV_REVIEW_REFERENCE_STAGED_ONLY"]);
});

test("F8 §87: valid new staged TEST -> PACKAGE -> price mapping stays pending",()=>{
  const rows=spreadsheetReferenceFindings([
    draft("TEST",{code:"NEW_TEST"}),
    draft("PACKAGE",{code:"NEW_PKG",memberTestCodes:["NEW_TEST","VISIBLE_TEST"]}),
    draft("PRICE_LIST_PACKAGE_ITEM",{priceListCode:"VISIBLE_LIST",packageCode:"NEW_PKG"}),
  ],live);
  assert.deepEqual(rows.map(codes),[
    [],["CSV_REVIEW_REFERENCE_STAGED_ONLY"],["CSV_REVIEW_REFERENCE_STAGED_ONLY"],
  ]);
});

test("F8 §87: duplicate staged clinical code blocks dependent package and price",()=>{
  const rows=spreadsheetReferenceFindings([
    draft("TEST",{code:"NEW_TEST"}),
    draft("TEST",{code:"new_test"},"ERROR"),
    draft("PACKAGE",{code:"NEW_PKG",memberTestCodes:["NEW_TEST"]}),
    draft("PRICE_LIST_PACKAGE_ITEM",{priceListCode:"VISIBLE_LIST",packageCode:"NEW_PKG"}),
  ],live);
  assert.ok(codes(rows[2]).includes("CSV_REVIEW_REFERENCE_MISSING_OR_OUT_OF_SCOPE"));
  assert.ok(codes(rows[3]).includes("CSV_REVIEW_REFERENCE_MISSING_OR_OUT_OF_SCOPE"));
});

test("F8 §87: duplicate package code blocks tariff when one row is in error",()=>{
  const rows=spreadsheetReferenceFindings([
    draft("PACKAGE",{code:"NEW_PKG",memberTestCodes:["VISIBLE_TEST"]}),
    draft("PACKAGE",{code:"new_pkg",memberTestCodes:[]},"ERROR"),
    draft("PRICE_LIST_PACKAGE_ITEM",{priceListCode:"VISIBLE_LIST",packageCode:"NEW_PKG"}),
  ],live);
  assert.ok(codes(rows[2]).includes("CSV_REVIEW_REFERENCE_MISSING_OR_OUT_OF_SCOPE"));
});

test("F8 §87: CSV and XLSX share dependency classification",()=>{
  const csv="entityType,code,memberTestCodes,priceListCode,packageCode\n"+
    'PACKAGE,PKG,"[""MISSING_TEST""]",,\n'+
    "PRICE_LIST_PACKAGE_ITEM,,,VISIBLE_LIST,PKG\n";
  const a=parseCsvReviewFile(csv);
  const b=parseCsvReviewFile(xlsxReviewToCsv(catalogReviewXlsx(csv)));
  assert.deepEqual(b,a);
  const rows=b.map(row=>draft(row.entityType,normalizeImportRow(row)));
  const results=spreadsheetReferenceFindings(rows,live);
  assert.deepEqual(results.map(codes),[
    ["CSV_REVIEW_REFERENCE_MISSING_OR_OUT_OF_SCOPE"],
    ["CSV_REVIEW_REFERENCE_MISSING_OR_OUT_OF_SCOPE"],
  ]);
});

test("F8 §87: protected CSV route remains DRAFT with live-scope recheck",()=>{
  const src=readFileSync("src/app/api/catalog/imports/csv/route.ts","utf8");
  const resolver=readFileSync("src/lib/catalog-csv-review-references.ts","utf8");
  assert.ok(resolver.includes("reviewEligibleStagedReferences(candidates, snapshot)"));
  assert.ok(src.includes("liveCatalogReviewStagingAuthority(tx"));
  assert.ok(src.includes("liveSpreadsheetReferenceFindings(tx"));
  assert.ok(src.indexOf("liveCatalogReviewStagingAuthority(tx")<
    src.indexOf("liveSpreadsheetReferenceFindings(tx"));
  assert.ok(src.includes('status: "DRAFT", validatedAt: null'));
  for(const endpoint of ["commit","revalidate"]) {
    assert.ok(readFileSync("src/app/api/catalog/imports/[id]/"+endpoint+"/route.ts","utf8")
      .includes('batch.sourceType === "CSV_REVIEW"'));
  }
});
