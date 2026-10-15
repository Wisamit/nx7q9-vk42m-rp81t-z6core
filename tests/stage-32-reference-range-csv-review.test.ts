import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseCsvReviewFile, CSV_STAGE_RANGE_TEMPLATE_HEADERS } from "../src/lib/catalog-review-csv-import.ts";
import { validateRangeCsvReview } from "../src/lib/catalog-range-csv-review.ts";
import { normalizeImportRow, rowValidationStatus, validateImportRow } from "../src/lib/catalog-import.ts";
const header=CSV_STAGE_RANGE_TEMPLATE_HEADERS.join(",");
const row=(fields: string) => parseCsvReviewFile("\uFEFF"+header+"\r\n"+fields+"\r\n")[0];
const candidate=(overrides: Record<string,string>={})=>({
  entityType:"REFERENCE_INTERVAL" as const,legacyKey:"legacy-01",
  data:{testName:"Thyroid stimulating hormone",unit:"mIU/L",sex:"ANY",ageFrom:"0.000",ageTo:"110.000",
    ageUnit:"YEAR",low:"0.400000",high:"4.500000",normalTextEn:"",...overrides},
});
test("canonical reference range CSV retains Arabic notes, exact decimal, clinical context and source identity",()=>{
  const parsed=row('REFERENCE_INTERVAL,range-1,"Free T4",pmol/L,FEMALE,12.000,70.000,YEAR,-1.250001,28.125000,"سليم, طبيعي"');
  assert.equal(parsed.entityType,"REFERENCE_INTERVAL");
  assert.equal(parsed.legacyKey,"range-1");
  assert.equal(parsed.data.normalTextEn,"سليم, طبيعي");
  const normalized=normalizeImportRow(parsed);
  assert.equal(normalized.low,"-1.250001");
  assert.equal(normalized.high,"28.125000");
  assert.equal(normalized.ageFrom,"12.000");
  assert.equal(normalized.ageTo,"70.000");
  assert.equal(normalized.ageUnit,"YEAR");
  assert.equal(normalized.normalTextEn,"سليم, طبيعي");
  const issues=[...validateImportRow(parsed.entityType,normalized),...validateRangeCsvReview(parsed)];
  assert.equal(rowValidationStatus(issues),"WARNING");
  assert.ok(issues.some(x=>x.code==="RANGE_REVIEW_CLINICAL_APPROVAL_REQUIRED"));
});
test("range stage requires mapped clinical context, valid sex, age and exact nonfloat limits",()=>{
  for (const [overrides,code] of [
    [{testName:""}, "RANGE_REVIEW_INVALID_TEST"],
    [{unit:""}, "RANGE_REVIEW_UNIT_REQUIRED"],
    [{sex:"X"}, "RANGE_REVIEW_INVALID_SEX"],
    [{ageUnit:"CENTURY"}, "RANGE_REVIEW_INVALID_AGE_UNIT"],
    [{ageUnit:""}, "RANGE_REVIEW_AGE_UNIT_REQUIRED"],
    [{ageFrom:"-1"}, "RANGE_REVIEW_INVALID_AGE_FROM"],
    [{ageFrom:"1.1234"}, "RANGE_REVIEW_INVALID_AGE_FROM"],
    [{ageFrom:"111.000",ageTo:"110.000"}, "RANGE_REVIEW_REVERSED_AGE"],
    [{low:"1e6"}, "RANGE_REVIEW_INVALID_LOW"],
    [{high:"4.1234567"}, "RANGE_REVIEW_INVALID_HIGH"],
    [{low:"5.000000",high:"4.999999"}, "RANGE_REVIEW_REVERSED_LIMITS"],
    [{low:"",high:"",normalTextEn:""}, "RANGE_REVIEW_EMPTY"],
    [{normalTextEn:"A".repeat(501)}, "RANGE_REVIEW_NORMAL_TEXT_TOO_LONG"],
  ] as const) {
    const issues=validateRangeCsvReview(candidate(overrides));
    assert.ok(issues.some(issue=>issue.code===code),code);
    assert.equal(rowValidationStatus(issues),"ERROR");
  }
  assert.equal(rowValidationStatus(validateRangeCsvReview(candidate({low:"-0.000001",high:"0.000000"}))),"WARNING");
});
test("review-only CSV allows draft tests but rejects unsupported price-list masters; formulas stay literal",()=>{
  const invalid=header+"\nPRICE_LIST,t-1,TSH,mIU/L,ANY,0,10,YEAR,1,4,";
  assert.throws(()=>parseCsvReviewFile(invalid),/csv_entity_review_only/);
  const draftTests=parseCsvReviewFile("entityType,legacyKey,code,nameEn\\nTEST,t1,TSH,Thyroid test".replace("\\n","\n"));
  assert.equal(draftTests[0].entityType,"TEST");
  const source=row('REFERENCE_INTERVAL,range-2,TSH,mIU/L,ANY,0,10,YEAR,1,4,"=SUM(A1:A2)"');
  assert.equal(source.data.normalTextEn,"=SUM(A1:A2)");
  assert.equal(rowValidationStatus(validateRangeCsvReview(source)),"WARNING");
  const existing=parseCsvReviewFile("entityType,legacyKey,testCode,code,nameEn,unitCode,resultType,priceListCode,unitPrice,effectiveFrom\nCOMPONENT,c1,TSH,FT4,Free T4,PMOL,NUMERIC,,,\nPRICE_LIST_ITEM,p1,TSH,,,,,ORG,123.4500,2026-10-09");
  assert.deepEqual(existing.map(r=>r.entityType),["COMPONENT","PRICE_LIST_ITEM"]);
});
test("CSV range route demands independent clinical role/scope, author-only disclosure and is never committable",()=>{
  const api=readFileSync("src/app/api/catalog/imports/csv/route.ts","utf8");
  const detail=readFileSync("src/app/catalog/imports/[id]/page.tsx","utf8");
  const index=readFileSync("src/app/catalog/page.tsx","utf8");
  const button=readFileSync("src/components/catalog-csv-review-staging.tsx","utf8");
  const commit=readFileSync("src/app/api/catalog/imports/[id]/commit/route.ts","utf8");
  const revalidate=readFileSync("src/app/api/catalog/imports/[id]/revalidate/route.ts","utf8");
  const rangePost=readFileSync("src/app/api/catalog/imports/[id]/reference-ranges/route.ts","utf8");
  assert.match(api,/catalog\.reference_ranges\.manage/);
  assert.match(api,/resolveClinicalImportScope/);
  assert.match(api,/validateRangeCsvReview/);
  assert.match(api,/status: "DRAFT"/);
  assert.doesNotMatch(api,/tx\.referenceInterval\.(?:create|update)/);
  assert.match(detail,/batch\.createdByUserId !== session\.user\.id/);
  assert.match(detail,/catalog\.reference_ranges\.manage/);
  assert.match(index,/canReviewCsvRanges/);
  assert.match(index,/rows: \{ none: \{ entityType: "REFERENCE_INTERVAL" \} \}/);
  assert.match(button,/canStageRanges/);
  assert.match(button,/saveTemplate\("range", "xlsx"\)/);
  assert.match(button,/"-review-template\."/);
  for(const writer of [commit,revalidate,rangePost])assert.match(writer,/batch\.sourceType === "CSV_REVIEW"/);
});
