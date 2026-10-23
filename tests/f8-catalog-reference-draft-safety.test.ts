import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  spreadsheetReferenceCodes, spreadsheetReferenceFindings,
} from "../src/lib/catalog-csv-review-references.ts";
import { normalizeImportRow, rowValidationStatus } from "../src/lib/catalog-import.ts";
import { parseCsvReviewFile } from "../src/lib/catalog-review-csv-import.ts";
import { catalogReviewXlsx } from "../src/lib/catalog-review-xlsx.ts";
import { xlsxReviewToCsv } from "../src/lib/catalog-review-xlsx-import.ts";

const candidate = (entityType: string, normalized: Record<string, unknown>,
  status: "VALID" | "WARNING" | "ERROR" = "WARNING") => ({entityType,normalized,status});
const snapshot = {
  tests: new Set(["VISIBLE_TEST"]),
  units: new Set(["VISIBLE_UNIT"]),
  packages: new Set(["VISIBLE_PACKAGE"]),
  priceLists: new Set(["VISIBLE_LIST"]),
};
const codes = (issues: Array<{code: string}>) => issues.map(issue=>issue.code);

test("F8 §87: component, panel, package and tariff edges are explicit, scoped and case-stable",()=>{
  const entries=[
    candidate("COMPONENT",{testCode:"VISIBLE_TEST",code:"C",unitCode:"VISIBLE_UNIT"}),
    candidate("PANEL",{code:"P",memberTestCodes:["VISIBLE_TEST"]}),
    candidate("PACKAGE",{code:"B",memberTestCodes:["VISIBLE_TEST"]}),
    candidate("PRICE_LIST_ITEM",{priceListCode:"VISIBLE_LIST",testCode:"VISIBLE_TEST"}),
    candidate("PRICE_LIST_PACKAGE_ITEM",{priceListCode:"VISIBLE_LIST",packageCode:"VISIBLE_PACKAGE"}),
  ];
  const needs=spreadsheetReferenceCodes(entries);
  assert.deepEqual([...needs.tests],["VISIBLE_TEST"]);
  assert.deepEqual([...needs.units],["VISIBLE_UNIT"]);
  assert.deepEqual([...needs.packages],["VISIBLE_PACKAGE"]);
  assert.deepEqual([...needs.priceLists],["VISIBLE_LIST"]);
  assert.deepEqual(spreadsheetReferenceFindings(entries,snapshot),[[],[],[],[],[]]);
});

test("F8 §87: inaccessible foreign or inactive masters never satisfy dependency or reveal identity",()=>{
  const entries=[
    candidate("COMPONENT",{testCode:"FOREIGN",code:"C",unitCode:"FOREIGN_UNIT"}),
    candidate("PANEL",{code:"P",memberTestCodes:["FOREIGN","VISIBLE_TEST"]}),
    candidate("PRICE_LIST_ITEM",{priceListCode:"FOREIGN_LIST",testCode:"VISIBLE_TEST"}),
    candidate("PRICE_LIST_PACKAGE_ITEM",{priceListCode:"VISIBLE_LIST",packageCode:"INACTIVE"}),
  ];
  const output=spreadsheetReferenceFindings(entries,snapshot);
  for (const issues of output) {
    assert.deepEqual(codes(issues),["CSV_REVIEW_REFERENCE_MISSING_OR_OUT_OF_SCOPE"]);
    assert.equal(rowValidationStatus(issues),"ERROR");
    assert.ok(!JSON.stringify(issues).includes("FOREIGN"));
  }
});

test("F8 §87: referencing a pending master is flagged, never treated as active",()=>{
  const entries=[
    candidate("TEST",{code:"NEW_TEST",nameEn:"New test"}),
    candidate("UNIT",{code:"NEW_UNIT",symbol:"u"}),
    candidate("PACKAGE",{code:"NEW_PACKAGE",memberTestCodes:["VISIBLE_TEST"]}),
    candidate("PRICE_LIST",{code:"NEW_LIST",currency:"AED"}),
    candidate("COMPONENT",{code:"ANALYTE",testCode:"NEW_TEST",unitCode:"NEW_UNIT"}),
    candidate("PRICE_LIST_ITEM",{priceListCode:"NEW_LIST",testCode:"NEW_TEST"}),
    candidate("PRICE_LIST_PACKAGE_ITEM",{priceListCode:"NEW_LIST",packageCode:"NEW_PACKAGE"}),
  ];
  const result=spreadsheetReferenceFindings(entries,snapshot);
  assert.ok(result.slice(0,4).every(x=>x.length===0));
  for (const issues of result.slice(4)) {
    assert.deepEqual(codes(issues),["CSV_REVIEW_REFERENCE_STAGED_ONLY"]);
    assert.equal(rowValidationStatus(issues),"WARNING");
  }
  entries[0].status="ERROR"; // invalid original draft TEST can no longer resolve linked component
  const rejected=spreadsheetReferenceFindings(entries,snapshot);
  assert.ok(codes(rejected[4]).includes("CSV_REVIEW_REFERENCE_MISSING_OR_OUT_OF_SCOPE"));
  assert.ok(codes(rejected[4]).includes("CSV_REVIEW_REFERENCE_STAGED_ONLY"));
});

test("F8 §87: CSV and native XLSX share the same normalized reference graph",()=>{
  const csv="entityType,legacyKey,code,nameEn,testCode,unitCode,resultType,priceListCode,unitPrice,effectiveFrom\n"+
    "TEST,a,NEW_TEST,New Test,,,,,,\n"+
    "COMPONENT,b,C,Analyte,NEW_TEST,VISIBLE_UNIT,NUMERIC,,,\n"+
    "PRICE_LIST_ITEM,c,,,NEW_TEST,,,VISIBLE_LIST,123.4500,2026-10-23\n";
  const original=parseCsvReviewFile(csv);
  const fromXlsx=parseCsvReviewFile(xlsxReviewToCsv(catalogReviewXlsx(csv)));
  assert.deepEqual(fromXlsx,original);
  const entries=fromXlsx.map(row=>candidate(row.entityType,normalizeImportRow(row)));
  const output=spreadsheetReferenceFindings(entries,snapshot);
  assert.equal(output[0].length,0);
  assert.deepEqual(codes(output[1]),["CSV_REVIEW_REFERENCE_STAGED_ONLY"]);
  assert.deepEqual(codes(output[2]),["CSV_REVIEW_REFERENCE_STAGED_ONLY"]);
});

test("F8 import reference snapshot is queried after live session reauthorization and remains DRAFT",()=>{
  const route=readFileSync("src/app/api/catalog/imports/csv/route.ts","utf8");
  const guard=readFileSync("src/lib/catalog-csv-review-references.ts","utf8");
  const commit=readFileSync("src/app/api/catalog/imports/[id]/commit/route.ts","utf8");
  const revalidate=readFileSync("src/app/api/catalog/imports/[id]/revalidate/route.ts","utf8");
  for(const required of ["liveCatalogReviewStagingAuthority(tx", "lookupCatalogStageReplay(tx",
    "liveSpreadsheetReferenceFindings(tx", "status: \"DRAFT\", validatedAt: null",
    "reviewOnly: true", "tx.catalogImportRow.createMany"])
    assert.ok(route.includes(required), required);
  assert.ok(route.indexOf("liveCatalogReviewStagingAuthority(tx") <
    route.indexOf("liveSpreadsheetReferenceFindings(tx"));
  assert.ok(guard.includes("clinicalImportTestWhere(clinicalScope)"));
  assert.ok(guard.includes("genericCatalogPriceScope(scope.authorizedBranchIds)"));
  assert.ok(guard.includes('organizationId: scope.organizationId, status: "ACTIVE"'));
  assert.ok(commit.includes('batch.sourceType === "CSV_REVIEW"'));
  assert.ok(revalidate.includes('batch.sourceType === "CSV_REVIEW"'));
});
