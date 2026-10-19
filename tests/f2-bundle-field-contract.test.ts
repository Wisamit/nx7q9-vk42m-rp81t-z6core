import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { catalogBundleAllowedSourceFields, catalogBundleNestedSourceProjections, type BundleNestedProjection } from "../src/lib/catalog-bundle-source-boundary.ts";
import {
  BundleFieldContractError, bundleFieldContract, verifyBundleFieldContract,
} from "../src/lib/catalog-bundle-field-contract.ts";
import { attestCatalogBundle, verifyCatalogBundleAttestation } from "../src/lib/catalog-bundle-attestation.ts";
import type { CatalogExportType } from "../src/lib/catalog-configuration-export.ts";
import { readFileSync } from "node:fs";

const ALL = [
  "TEST","COMPONENT","UNIT","CONTAINER","PANEL","PACKAGE",
  "REFERENCE_INTERVAL","PRICE_LIST","PRICE_LIST_ITEM","PRICE_LIST_PACKAGE_ITEM",
] as const;
const SECRET="synthetic-nonproduction-f2-bundle-secret-length-over-32-bytes";

function syntheticNested(shape: BundleNestedProjection): Record<string, unknown> {
  return Object.fromEntries(Object.entries(shape).map(([name, child]) => [
    name, child === true ? null : Array.isArray(child)
      ? [syntheticNested(child[0])] : syntheticNested(child as BundleNestedProjection),
  ]));
}
function syntheticRecord(type: CatalogExportType) {
  const record=Object.fromEntries(catalogBundleAllowedSourceFields[type].map(name=>[name,null]));
  Object.assign(record,syntheticNested(catalogBundleNestedSourceProjections[type]));
  return record;
}
function exampleBundle(types: readonly CatalogExportType[]=ALL) {
  return {
    format:"family-lab-catalog-bundle",
    schemaVersion:1,
    organizationId:"00000000-0000-4000-8000-000000000001",
    exportedAt:"2026-10-19T00:00:00.000Z",
    consistency:"transactional-consistent-read",
    groups:types.map(entityType=>({entityType,records:[syntheticRecord(entityType)]})),
    fieldContract:bundleFieldContract(types),
  };
}
test("F2: all ten source types have canonical deterministic field contracts",()=>{
  const payload=exampleBundle();
  assert.equal(payload.fieldContract.classes.length,10);
  assert.equal(verifyBundleFieldContract(payload),"COMPLETE_SOURCE_FIELD_PROJECTION");
  for (const cls of payload.fieldContract.classes) {
    assert.ok(cls.fields.length>=6,cls.entityType);
    assert.deepEqual([...cls.fields].sort(),cls.fields);
    assert.equal(new Set(cls.fields).size,cls.fields.length);
  }
});
test("F2: HMAC covers field contract and every exact source value",()=>{
  const original=attestCatalogBundle(exampleBundle(),SECRET);
  assert.equal(verifyCatalogBundleAttestation(original,SECRET),"VERIFIED");
  assert.equal(verifyBundleFieldContract(original),"COMPLETE_SOURCE_FIELD_PROJECTION");
  const tampered=structuredClone(original) as Record<string, unknown>;
  const fieldContract=tampered.fieldContract as { classes: Array<{ fields: string[] }> };
  fieldContract.classes[0].fields.pop();
  assert.equal(assert.throws(()=>verifyBundleFieldContract(tampered),BundleFieldContractError),undefined);
  assert.throws(()=>verifyCatalogBundleAttestation(tampered,SECRET),/bundle_attestation_mismatch/);
});
test("F2: deleted/renamed/additional source keys cannot masquerade as a complete signed projection",()=>{
  for (const kind of ALL) {
    const payload=exampleBundle([kind]);
    const row=payload.groups[0].records[0];
    const first=Object.keys(row)[0];
    delete row[first];
    assert.throws(()=>verifyBundleFieldContract(payload),/bundle_field_contract_incomplete_source/,kind);
    row[first]=null;
    row.__extraField=null;
    assert.throws(()=>verifyBundleFieldContract(payload),/bundle_field_contract_incomplete_source/,kind);
  }
});
test("F2: nested fields are exact for every linked entity and every composite member",()=>{
  const affected = [
    ["COMPONENT","test"],["COMPONENT","unit"],["PANEL","items"],
    ["PACKAGE","items"],["REFERENCE_INTERVAL","component"],
    ["PRICE_LIST_ITEM","priceList"],["PRICE_LIST_ITEM","test"],
    ["PRICE_LIST_PACKAGE_ITEM","priceList"],["PRICE_LIST_PACKAGE_ITEM","package"],
  ] as const;
  for (const [kind,relation] of affected) {
    const payload=exampleBundle([kind]);
    const row=payload.groups[0].records[0];
    const original=row[relation];
    row[relation]=null;
    assert.throws(()=>verifyBundleFieldContract(payload),
      /bundle_field_contract_incomplete_nested_source/,kind+"."+relation);
    row[relation]=original;
  }
  // One explicitly nullable Prisma relation is allowed, unlike an omitted key.
  const nullable=exampleBundle(["COMPONENT"]);
  nullable.groups[0].records[0].unit=null;
  assert.equal(verifyBundleFieldContract(nullable),"COMPLETE_SOURCE_FIELD_PROJECTION");
});
test("F2: nested missing/extra fields, partial member and price linkage are not attested as complete",()=>{
  const cases=[
    ["COMPONENT",(r: Record<string, unknown>)=>{delete (r.test as Record<string, unknown>).code;}],
    ["REFERENCE_INTERVAL",(r: Record<string, unknown>)=>{delete ((r.component as Record<string, unknown>).test as Record<string, unknown>).code;}],
    ["PANEL",(r: Record<string, unknown>)=>{delete (((r.items as Record<string, unknown>[])[0]).test as Record<string, unknown>).code;}],
    ["PACKAGE",(r: Record<string, unknown>)=>{(r.items as Record<string, unknown>[])[0].extraneous="no";}],
    ["PRICE_LIST_ITEM",(r: Record<string, unknown>)=>{delete (r.priceList as Record<string, unknown>).currency;}],
    ["PRICE_LIST_PACKAGE_ITEM",(r: Record<string, unknown>)=>{delete (r.priceList as Record<string, unknown>).contractId;}],
  ] as const;
  for(const [kind,mutate] of cases){
    const payload=exampleBundle([kind]);
    mutate(payload.groups[0].records[0]);
    // Even a server with the HMAC key must not sign an incomplete source.
    const signed=attestCatalogBundle(payload,SECRET);
    assert.equal(verifyCatalogBundleAttestation(signed,SECRET),"VERIFIED");
    assert.throws(()=>verifyBundleFieldContract(signed),
      /bundle_field_contract_incomplete_nested_source/,kind);
  }
});
test("F2: source contract fails closed on reordered, missing and invented classes",()=>{
  const payload=exampleBundle();
  payload.fieldContract.classes.reverse();
  assert.throws(()=>verifyBundleFieldContract(payload),/bundle_field_contract_mismatch/);
  assert.throws(()=>bundleFieldContract(["TEST","TEST"]),/bundle_field_contract_invalid_type/);
  assert.throws(()=>bundleFieldContract(["PATIENT" as CatalogExportType]),/bundle_field_contract_invalid_type/);
});
test("F2: legacy v1 snapshot stays DRAFT with unproven completeness, not secretly upgraded",()=>{
  const payload=exampleBundle();
  const legacy=Object.fromEntries(Object.entries(payload).filter(([key])=>key!=="fieldContract"));
  const signed=attestCatalogBundle(legacy,SECRET);
  assert.equal(verifyCatalogBundleAttestation(signed,SECRET),"VERIFIED");
  assert.equal(verifyBundleFieldContract(signed),"LEGACY_NO_FIELD_CONTRACT");
});
test("F2: static route wiring protects field contract, live HMAC and never activates a review",()=>{
  const exportRoute=readFileSync("src/app/api/catalog/configuration-export/bundle/route.ts","utf8");
  const importRoute=readFileSync("src/app/api/catalog/imports/bundle/route.ts","utf8");
  const commit=readFileSync("src/app/api/catalog/imports/[id]/commit/route.ts","utf8");
  assert.match(exportRoute,/fieldContract: bundleFieldContract\(/);
  assert.match(exportRoute,/verifyBundleFieldContract\(payload\)/);
  assert.match(exportRoute,/attestCatalogBundle/);
  assert.match(importRoute,/verifyCatalogBundleAttestation\(payload/);
  assert.match(importRoute,/verifyBundleFieldContract\(payload\)/);
  assert.match(importRoute,/SOURCE_FIELD_CONTRACT_NOT_PROVEN/);
  assert.match(importRoute,/status: "DRAFT"/);
  assert.match(commit,/CONFIG_BUNDLE_REVIEW/);
  assert.match(commit,/csv_review_is_not_committable/);
  assert.doesNotMatch(exportRoute,/export async function POST/);
});
