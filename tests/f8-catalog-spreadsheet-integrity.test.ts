import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseCsvReviewFile } from "../src/lib/catalog-review-csv-import.ts";
import { catalogReviewXlsx } from "../src/lib/catalog-review-xlsx.ts";
import { xlsxReviewToCsv } from "../src/lib/catalog-review-xlsx-import.ts";
import { normalizeImportRow, rowValidationStatus } from "../src/lib/catalog-import.ts";
import {
  strictCsvEffectiveInstant, csvReviewTariffRowIssues, csvReviewBatchConflictIssues,
} from "../src/lib/catalog-csv-review-integrity.ts";

const rate = (effectiveFrom: string, effectiveTo: string, unitPrice = "123.4500") => ({
  priceListCode: "ORG_AED", testCode: "TSH", unitPrice, effectiveFrom, effectiveTo,
});
const batch = (...rows: Array<{ entityType: string; normalized: Record<string, unknown> }>) =>
  csvReviewBatchConflictIssues(rows);
const issueCodes = (issues: Array<{ code: string }>) => issues.map(issue => issue.code);

test("F8 §87: exact UTC calendar inputs reject rollover, offsets and ambiguous finance dates", () => {
  for (const valid of ["2028-02-29", "2026-10-15", "2026-10-15T13:02:03Z",
    "2026-10-15T13:02:03.1Z", "2026-10-15T13:02:03.123Z"]) {
    assert.notEqual(strictCsvEffectiveInstant(valid), null, valid);
  }
  for (const invalid of ["2026-02-29", "2026-02-30", "2026-13-01",
    "2026-01-01T24:00:00Z", "2026-10-15T00:00:00+04:00",
    "2026-10-15 00:00:00", "10/15/2026", "2026-10-15T13:00Z",
    "2026-10-15T00:00:00.1234Z", "2026-10-15foobar", "", null]) {
    assert.equal(strictCsvEffectiveInstant(invalid), null, String(invalid));
  }
});

test("F8 §§86/87: tariff review preserves exact DECIMAL(18,4) and never guesses fiscal policy", () => {
  for (const type of ["PRICE_LIST_ITEM", "PRICE_LIST_PACKAGE_ITEM"]) {
    for (const amount of ["0", "0.0000", "123.4500", "99999999999999.9999"]) {
      assert.deepEqual(csvReviewTariffRowIssues(type, rate("2026-10-15", "", amount)), [],
        type + ":" + amount);
    }
    for (const amount of ["100000000000000", "999999999999999.99", "1.00001",
      "-1", "1e6", "1,000", "NaN", "0001", ""]) {
      assert.ok(issueCodes(csvReviewTariffRowIssues(type,
        rate("2026-10-15", "", amount))).includes("CSV_TARIFF_DECIMAL_OUT_OF_RANGE"), amount);
    }
    for (const [from, to] of [["2026-02-30", ""], ["2026-10-15", "2026-02-30"],
      ["2026-10-15", "2026-10-14"], ["2026-10-15T11:00:00+04:00", ""],
      ["2026-10-15", "next month"]]) {
      assert.ok(issueCodes(csvReviewTariffRowIssues(type,
        rate(from, to))).includes("CSV_TARIFF_EFFECTIVE_WINDOW_INVALID"),
        type + ":" + from + ":" + to);
    }
    assert.deepEqual(csvReviewTariffRowIssues(type, rate("2026-10-15", "2026-10-16")), []);
  }
  assert.deepEqual(csvReviewTariffRowIssues("TEST", rate("bad", "bad", "bad")), []);
});

test("F8 §87: duplicates are marked on BOTH rows, scoped by kind/parent/effective version", () => {
  const rows = batch(
    {entityType:"TEST",normalized:{code:"CBC"}},
    {entityType:"TEST",normalized:{code:"cbc"}},
    {entityType:"PANEL",normalized:{code:"CBC"}},
    {entityType:"COMPONENT",normalized:{testCode:"CBC",code:"RBC"}},
    {entityType:"COMPONENT",normalized:{testCode:"CBC",code:"RBC"}},
    {entityType:"COMPONENT",normalized:{testCode:"OTHER",code:"RBC"}},
  );
  for (const i of [0, 1, 3, 4]) {
    assert.ok(issueCodes(rows[i]).includes("CSV_DUPLICATE_STAGED_IDENTITY"), String(i));
    assert.equal(rowValidationStatus(rows[i]), "ERROR");
  }
  for (const i of [2, 5]) assert.equal(rows[i].length, 0);
});

test("F8 §§17/87: same tariff item with disjoint effective windows stays distinct", () => {
  const results=batch(
    {entityType:"PRICE_LIST_ITEM",normalized:rate("2026-10-01","2026-10-14")},
    {entityType:"PRICE_LIST_ITEM",normalized:rate("2026-10-15","2026-12-31")},
    {entityType:"PRICE_LIST_ITEM",normalized:{...rate("2026-10-01",""),testCode:"ALT"}},
    {entityType:"PRICE_LIST_PACKAGE_ITEM",normalized:{
      priceListCode:"ORG_AED",packageCode:"TSH",effectiveFrom:"2026-10-01",effectiveTo:"",
    }},
  );
  assert.ok(results.every(row => row.length===0));
});

test("F8 §87: overlapping tariff windows and duplicate exact effective starts are explicit review findings", () => {
  const results=batch(
    {entityType:"PRICE_LIST_ITEM",normalized:rate("2026-10-01","2026-11-30")},
    {entityType:"PRICE_LIST_ITEM",normalized:rate("2026-10-15","2026-12-01")},
    {entityType:"PRICE_LIST_ITEM",normalized:rate("2026-10-15","")},
    {entityType:"PRICE_LIST_ITEM",normalized:rate("2027-01-01","")},
  );
  for (const i of [0,1,2,3]) {
    assert.ok(issueCodes(results[i]).includes("CSV_TARIFF_WINDOWS_OVERLAP"), String(i));
  }
  for (const i of [1,2])
    assert.ok(issueCodes(results[i]).includes("CSV_DUPLICATE_STAGED_IDENTITY"));
  assert.ok(!issueCodes(results[0]).includes("CSV_DUPLICATE_STAGED_IDENTITY"));
  const isolated=batch(
    {entityType:"PRICE_LIST_ITEM",normalized:rate("2026-10-15","2026-10-15")},
    {entityType:"PRICE_LIST_ITEM",normalized:rate("2026-10-16","")},
  );
  assert.deepEqual(isolated,[[],[]]);
});

test("F8: the same safety review runs on CSV and XLSX decoded rows without activation", () => {
  const fields=["entityType","legacyKey","priceListCode","testCode","unitPrice","effectiveFrom","effectiveTo"];
  const csv=fields.join(",")+"\r\n"+
    "PRICE_LIST_ITEM,one,ORG_AED,TSH,100.0000,2026-02-30,\r\n"+
    "PRICE_LIST_ITEM,two,ORG_AED,TSH,100000000000000,2026-10-01,\r\n"+
    "PRICE_LIST_ITEM,three,ORG_AED,TSH,20.0000,2026-10-01,\r\n";
  const original=parseCsvReviewFile(csv);
  const excel=parseCsvReviewFile(xlsxReviewToCsv(catalogReviewXlsx(csv)));
  assert.deepEqual(excel,original);
  const normalized=excel.map(row=>normalizeImportRow(row));
  const conflict=csvReviewBatchConflictIssues(excel.map((row,i)=>({
    entityType:row.entityType,normalized:normalized[i],
  })));
  assert.ok(issueCodes(csvReviewTariffRowIssues("PRICE_LIST_ITEM",normalized[0]))
    .includes("CSV_TARIFF_EFFECTIVE_WINDOW_INVALID"));
  assert.ok(issueCodes(csvReviewTariffRowIssues("PRICE_LIST_ITEM",normalized[1]))
    .includes("CSV_TARIFF_DECIMAL_OUT_OF_RANGE"));
  assert.ok(issueCodes(conflict[1]).includes("CSV_DUPLICATE_STAGED_IDENTITY"));
  assert.ok(issueCodes(conflict[2]).includes("CSV_DUPLICATE_STAGED_IDENTITY"));
});

test("F8 import remains author-private, permission-scoped and DRAFT only", () => {
  const route=readFileSync("src/app/api/catalog/imports/csv/route.ts","utf8");
  const commit=readFileSync("src/app/api/catalog/imports/[id]/commit/route.ts","utf8");
  const revalidate=readFileSync("src/app/api/catalog/imports/[id]/revalidate/route.ts","utf8");
  for (const guard of ["liveCatalogReviewStagingAuthority", "csvReviewTariffRowIssues",
    "csvReviewBatchConflictIssues", 'sourceType: "CSV_REVIEW"',
    'status: "DRAFT", validatedAt: null', 'reviewOnly: true', "pricing.manage",
    "catalog.reference_ranges.manage", "lookupCatalogStageReplay"])
    assert.ok(route.includes(guard),guard);
  assert.ok(commit.includes('batch.sourceType === "CSV_REVIEW"'));
  assert.ok(revalidate.includes('batch.sourceType === "CSV_REVIEW"'));
});
