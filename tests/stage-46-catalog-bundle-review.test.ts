import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  BUNDLE_REVIEW_MAX_BYTES, BUNDLE_REVIEW_MAX_ROWS, BUNDLE_REVIEW_SOURCE,
  CatalogBundleReviewError, isReviewOnlyCatalogSource, parseCatalogBundleForReview,
} from "../src/lib/catalog-bundle-review.ts";

const org="11111111-1111-4111-8111-111111111111";
const ids=["22222222-2222-4222-8222-222222222222","33333333-3333-4333-8333-333333333333",
  "44444444-4444-4444-8444-444444444444","55555555-5555-4555-8555-555555555555",
  "66666666-6666-4666-8666-666666666666","77777777-7777-4777-8777-777777777777"];
const branch="88888888-8888-4888-8888-888888888888";
const date="2026-10-10T00:00:00.000Z";
const example=[
  {entityType:"TEST", records:[{id:ids[0],code:"GLU",nameEn:"Glucose",departmentId:null,status:"ACTIVE"}]},
  {entityType:"UNIT", records:[{id:ids[1],code:"MGDL",symbol:"mg/dL",status:"ACTIVE"}]},
  {entityType:"COMPONENT", records:[{id:ids[2],testId:ids[0],test:{code:"GLU"},unitId:ids[1],
    code:"GLUCOSE",nameEn:"Glucose",status:"ACTIVE"}]},
  {entityType:"REFERENCE_INTERVAL", records:[{id:ids[3],componentId:ids[2],
    component:{code:"GLUCOSE",test:{code:"GLU"}},effectiveFrom:date,branchId:branch,
    approvalStatus:"APPROVED",status:"ACTIVE",lowValue:"70.500000"}]},
  {entityType:"PRICE_LIST", records:[{id:ids[4],code:"BR_AED",scopeType:"BRANCH",
    branchId:branch,currency:"AED",status:"ACTIVE"}]},
  {entityType:"PRICE_LIST_ITEM", records:[{id:ids[5],priceListId:ids[4],testId:ids[0],
    test:{code:"GLU"},priceList:{code:"BR_AED",scopeType:"BRANCH",branchId:branch},
    unitPrice:"110.1250",effectiveFrom:date,status:"ACTIVE"}]},
] as Array<{entityType:string; records:Array<Record<string,unknown>>}>;
const bundle=(groups=example,organizationId=org)=>({
  format:"family-lab-catalog-bundle",schemaVersion:1,
  organizationId,exportedAt:date,consistency:"paged-live-not-atomic",groups,
});
const allowed={pricing:true,ranges:true};
const reject=(payload:unknown, expected:string, permissions=allowed)=>{
  assert.throws(()=>parseCatalogBundleForReview(payload,org,permissions),
    (e:unknown)=>e instanceof CatalogBundleReviewError && e.code===expected,expected);
};

test("Stage 46: six exported categories retain IDs, exact decimals and warning-only review provenance",()=>{
  const staged=parseCatalogBundleForReview(bundle(),org,allowed);
  assert.equal(staged.rows.length,6);
  assert.deepEqual(staged.ids.tests,[ids[0]]);
  assert.deepEqual(staged.ids.components,[ids[2]]);
  assert.deepEqual(staged.ids.intervals,[ids[3]]);
  assert.equal(staged.rows[5].normalized.unitPrice,"110.1250");
  assert.equal(staged.rows[3].original.lowValue,"70.500000");
  assert.equal(staged.rows[4].normalized.branchId,branch);
  assert.deepEqual(staged.counts,{TEST:1,UNIT:1,COMPONENT:1,REFERENCE_INTERVAL:1,PRICE_LIST:1,PRICE_LIST_ITEM:1});
  assert.equal(BUNDLE_REVIEW_MAX_BYTES,4*1024*1024);
  assert.equal(BUNDLE_REVIEW_MAX_ROWS,5000);
  assert.equal(BUNDLE_REVIEW_SOURCE,"CONFIG_BUNDLE_REVIEW");
  assert.equal(isReviewOnlyCatalogSource(BUNDLE_REVIEW_SOURCE),true);
  assert.equal(isReviewOnlyCatalogSource("CSV_REVIEW"),true);
  assert.equal(isReviewOnlyCatalogSource("LEGACY_MDB_EXPORT"),false);
});

test("Stage 46: reject cross-organization, malformed, duplicate or ambiguous source manifests",()=>{
  reject(bundle(example,"99999999-9999-4999-8999-999999999999"),"bundle_foreign_organization");
  reject({...bundle(),format:"legacy-backup"},"bundle_unsupported_format");
  reject({...bundle(),schemaVersion:2},"bundle_unsupported_format");
  reject({...bundle(),consistency:"transactional"},"bundle_unsupported_format");
  reject({...bundle(),exportedAt:"tomorrow"},"bundle_invalid_export_date");
  reject(bundle([]),"bundle_invalid_groups");
  reject(bundle([...example,example[0]]),"bundle_invalid_groups");
  reject(bundle([{entityType:"TEST",records:[...example[0].records,...example[0].records]}]),"bundle_duplicate_master");
  reject(bundle([{entityType:"TEST",records:[]}]),"bundle_empty");
  reject(bundle([{entityType:"CONTAINER",records:[{id:ids[0]}]}]),"bundle_invalid_group");
  reject(bundle([{entityType:"TEST",records:[{...example[0].records[0],id:"malformed"}]}]),"bundle_invalid_record_id");
  reject(bundle([{entityType:"TEST",records:[{...example[0].records[0],nameEn:""}]}]),"bundle_invalid_identity");
});

test("Stage 46: clinical ranges and financial values require distinct existing privileges",()=>{
  reject(bundle([example[3]]),"reference_ranges_manage_required",{pricing:true,ranges:false});
  reject(bundle([example[4]]),"pricing_manage_required",{pricing:false,ranges:true});
  reject(bundle([example[5]]),"pricing_manage_required",{pricing:false,ranges:true});
  reject(bundle([{entityType:"PRICE_LIST",records:[{...example[4].records[0],scopeType:"CLIENT"}]}]),
    "bundle_price_scope_requires_separate_governance");
  reject(bundle([{entityType:"PRICE_LIST_ITEM",records:[{...example[5].records[0],
    priceList:{code:"CLIENT",scopeType:"CONTRACT",branchId:null}}]}]),
    "bundle_price_scope_requires_separate_governance");
  for(const invalid of ["1e10","1.12345","-2","NaN",101.125, "100000000000000.0000"]){
    reject(bundle([{entityType:"PRICE_LIST_ITEM",records:[{...example[5].records[0],unitPrice:invalid}]}]),
      "bundle_invalid_decimal_price");
  }
});

test("Stage 46: all legacy mutation routes reject JSON review source before any writes",()=>{
  for(const path of [
    "commit","revalidate","prepare-units","mappings","reference-ranges",
  ]){
    const source=readFileSync("src/app/api/catalog/imports/[id]/"+path+"/route.ts","utf8");
    assert.match(source,/sourceType === "CONFIG_BUNDLE_REVIEW"/,path);
    assert.match(source,/sourceType === "CSV_REVIEW"/,path);
  }
  const prepare=readFileSync("src/app/api/catalog/imports/[id]/prepare-units/route.ts","utf8");
  assert.match(prepare,/currentBatch\.sourceType === "CONFIG_BUNDLE_REVIEW"/);
  const page=readFileSync("src/app/catalog/imports/[id]/page.tsx","utf8");
  assert.match(page,/const isBundleReview = batch\.sourceType === BUNDLE_REVIEW_SOURCE/);
  assert.match(page,/batch\.createdByUserId !== session\.user\.id/);
  assert.match(page,/!isBundleReview && entityCounts\.COMPONENT/);
  assert.match(page,/!isBundleReview && entityCounts\.PRICE_LIST_ITEM/);
  assert.match(page,/!isBundleReview && <RevalidateImportButton/);
  assert.match(page,/!isBundleReview && safeMasterRemaining/);
  const route=readFileSync("src/app/api/catalog/imports/bundle/route.ts","utf8");
  assert.match(route,/resolveClinicalImportScope/);
  assert.match(route,/bundle_master_identity_or_scope_changed/);
  assert.match(route,/bundle_master_mapping_mismatch/);
  assert.match(route,/status: "DRAFT", validatedAt: null/);
  assert.match(route,/status: "WARNING"/);
  assert.match(route,/sourceType: BUNDLE_REVIEW_SOURCE/);
  assert.doesNotMatch(route,/tx\.(?:labTest|testComponent|referenceInterval|priceListItem)\.(?:create|update|upsert)/);
});

test("Stage 46: generic exports exclude private client/contract financial scopes",()=>{
  const exp=readFileSync("src/app/api/catalog/configuration-export/route.ts","utf8");
  assert.match(exp,/const genericPriceScope/);
  assert.match(exp,/scopeType: "ORGANIZATION"/);
  assert.match(exp,/scopeType: "BRANCH"/);
  assert.match(exp,/priceList: \{ organizationId, \.\.\.genericPriceScope \}/);
  assert.match(exp,/permissions\.has\("catalog\.reference_ranges\.manage"\)/);
  const catalog=readFileSync("src/app/catalog/page.tsx","utf8");
  assert.match(catalog,/CatalogBundleReviewStaging/);
  assert.match(catalog,/canExportRanges=\{canReviewCsvRanges\}/);
  const exportUi=readFileSync("src/components/catalog-configuration-export.tsx","utf8");
  assert.match(exportUi,/canExportRanges \? \["REFERENCE_INTERVAL" as const\]/);
  assert.match(exportUi,/canExportRanges \|\| t !== "REFERENCE_INTERVAL"/);
  const ui=readFileSync("src/components/catalog-bundle-review-staging.tsx","utf8");
  assert.match(ui,/reviewOnly !== true/);
  assert.match(ui,/Stage JSON bundle for review/);
});
