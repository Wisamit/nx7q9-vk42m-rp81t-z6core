import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { catalogExportTypes } from "../src/lib/catalog-configuration-export.ts";
import { catalogBundleAllowedSourceFields } from "../src/lib/catalog-bundle-source-boundary.ts";
import {
  catalogFieldCoverageGaps, classifyCatalogReviewDrift,
  classifyCatalogReviewField,
} from "../src/lib/catalog-field-review-eligibility.ts";

test("F2: field eligibility vocabulary exhaustively accounts for all ten exact export source contracts",()=>{
  assert.equal(catalogExportTypes.size,10);
  assert.deepEqual(catalogFieldCoverageGaps(),[]);
  for(const kind of catalogExportTypes){
    for(const field of catalogBundleAllowedSourceFields[kind]){
      assert.notEqual(classifyCatalogReviewField(kind,field),"UNMAPPED_BLOCKED",
        kind+"."+field);
    }
  }
});
test("F2: clinical/financial/composite versioning never creates auto-apply permission",()=>{
  assert.equal(classifyCatalogReviewField("TEST","nameEn"),"CLINICAL_VERSIONED_REVIEW");
  assert.equal(classifyCatalogReviewField("REFERENCE_INTERVAL","criticalHigh"),"CLINICAL_VERSIONED_REVIEW");
  assert.equal(classifyCatalogReviewField("COMPONENT","reportNameAr"),"CLINICAL_VERSIONED_REVIEW");
  assert.equal(classifyCatalogReviewField("PRICE_LIST_ITEM","unitPrice"),"FINANCIAL_VERSIONED_REVIEW");
  assert.equal(classifyCatalogReviewField("PRICE_LIST","effectiveTo"),"FINANCIAL_VERSIONED_REVIEW");
  assert.equal(classifyCatalogReviewField("PACKAGE","descriptionEn"),"CROSS_DOMAIN_VERSIONED_REVIEW");
  assert.equal(classifyCatalogReviewField("PANEL","items.0.testId"),"IDENTITY_RECONCILIATION");
  assert.equal(classifyCatalogReviewField("PANEL","items.0.required"),"IDENTITY_RECONCILIATION");
  assert.equal(classifyCatalogReviewField("REFERENCE_INTERVAL","component.test.code"),"IDENTITY_RECONCILIATION");
  assert.equal(classifyCatalogReviewField("PRICE_LIST_ITEM","priceList.currency"),"IDENTITY_RECONCILIATION");
  assert.equal(classifyCatalogReviewField("PRICE_LIST","clientId"),"IDENTITY_RECONCILIATION");
  assert.equal(classifyCatalogReviewField("TEST","createdAt"),"IMMUTABLE_SYSTEM");
  assert.equal(classifyCatalogReviewField("REFERENCE_INTERVAL","approvedAt"),"IMMUTABLE_SYSTEM");
  const result=classifyCatalogReviewDrift("PRICE_LIST_ITEM",[
    "unitPrice","priceList.branchId","effectiveFrom",
  ],false);
  assert.equal(result.completeFieldInventory,true);
  assert.equal(result.autoApplyAllowed,false);
  assert.equal(result.reviewOnly,true);
  assert.equal(result.qualifiedApprovalRequired,true);
  assert.equal(result.versionedApplicationRequired,true);
  assert.equal(result.fields.length,3);
});
test("F2: unknown, truncated, out-of-schema or nested forged fields fail closed without values",()=>{
  for(const [kind,path] of [
    ["TEST","fakeClinicalField"],["TEST","id.fake"],["PANEL","items.0.patientId"],
    ["PANEL","items.0.test.extra"],["PRICE_LIST","privateTariff"],
    ["PRICE_LIST_ITEM","priceList.discount"],["REFERENCE_INTERVAL","component.other"],
    ["UNKNOWN","code"],["TEST","(root)"],
  ]){
    assert.equal(classifyCatalogReviewField(kind,path),"UNMAPPED_BLOCKED",kind+"."+path);
  }
  const partial=classifyCatalogReviewDrift("TEST",["nameEn"],true);
  assert.equal(partial.completeFieldInventory,false);
  assert.equal(partial.autoApplyAllowed,false);
  const forged=classifyCatalogReviewDrift("TEST",["nameEn","secretField"],false);
  assert.equal(forged.completeFieldInventory,false);
  assert.equal(forged.unmappedFieldPresent,true);
  assert.equal(forged.fields[1].classification,"UNMAPPED_BLOCKED");
  assert.throws(()=>classifyCatalogReviewDrift("TEST",Array(101).fill("code"),false));
  assert.throws(()=>classifyCatalogReviewDrift("TEST",["code"],null as unknown as boolean));
});
test("F2: only returned field names and non-activating classes can leave the live drift response",()=>{
  const route=readFileSync("src/app/api/catalog/imports/[id]/bundle-drift/route.ts","utf8");
  const ui=readFileSync("src/components/catalog-bundle-drift-review.tsx","utf8");
  const commit=readFileSync("src/app/api/catalog/imports/[id]/commit/route.ts","utf8");
  assert.match(route,/classifyCatalogReviewDrift\(/);
  assert.match(route,/fieldReview:/);
  assert.match(ui,/autoApplyAllowed !== false/);
  assert.match(commit,/CONFIG_BUNDLE_REVIEW/);
  assert.match(commit,/CSV_REVIEW/);
  assert.doesNotMatch(route,/tx\.(?:labTest|referenceInterval|priceListItem)\.(?:update|upsert|delete)/);
});
