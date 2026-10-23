import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { checkedAtomicCatalogReviewSource, AtomicReviewSourceError } from "../src/lib/catalog-atomic-review-source.ts";
import { catalogExportTypes, type CatalogExportType } from "../src/lib/catalog-configuration-export.ts";
import { bundleFieldContract } from "../src/lib/catalog-bundle-field-contract.ts";
import { catalogBundleAllowedSourceFields, catalogBundleNestedSourceProjections,
  type BundleNestedProjection } from "../src/lib/catalog-bundle-source-boundary.ts";
import { catalogReviewCsv } from "../src/lib/catalog-review-csv.ts";
import { catalogReviewXlsx, parseReviewCsvCells } from "../src/lib/catalog-review-xlsx.ts";
import { xlsxReviewToCsv } from "../src/lib/catalog-review-xlsx-import.ts";
import { parseCsvReviewFile, CsvStagingError } from "../src/lib/catalog-review-csv-import.ts";

const types=[...catalogExportTypes];
const uuid=()=>randomUUID();
const fixedExportAt="2026-10-23T17:10:05.000Z";
function nested(shape:BundleNestedProjection | readonly [BundleNestedProjection]):unknown {
  if(Array.isArray(shape))return [nested(shape[0])];
  const output:Record<string,unknown>={};
  for(const [key,value] of Object.entries(shape)){
    output[key]=value===true ? key==="code"?"CBC":key==="testId"?uuid():key==="displayOrder"?0:true
      : nested(value as BundleNestedProjection);
  }
  return output;
}
function source(type:CatalogExportType):Record<string,unknown> {
  const record=Object.fromEntries(catalogBundleAllowedSourceFields[type].map(k=>[k,null])) as Record<string,unknown>;
  record.id=uuid();
  if("status" in record)record.status="ACTIVE";
  if("code" in record)record.code="CODE_A";
  if("nameEn" in record)record.nameEn="Example";
  if("nameAr" in record)record.nameAr="مثال للمختبر";
  if(type==="UNIT"){record.symbol="mg/dL";record.ucumCode="mg/dL";}
  if(type==="CONTAINER"){record.tubeColor="Purple";record.additive="K2 EDTA";}
  if(type==="PRICE_LIST" || type==="PRICE_LIST_ITEM" || type==="PRICE_LIST_PACKAGE_ITEM"){
    record.effectiveFrom="2026-01-01T00:00:00.000Z";
    record.effectiveTo=null;
  }
  if(type==="REFERENCE_INTERVAL"){
    record.lowValue="5.000000";record.highValue="20.000000";
    record.criticalLow="-1.000000";record.criticalHigh="55.500000";
    record.sex="ANY";record.normalTextAr="ضمن المجال المرجعي";
    record.effectiveFrom="2026-01-01T00:00:00.000Z";
    record.effectiveTo=null;
  }
  if(type==="PRICE_LIST"){record.currency="AED";record.scopeType="ORGANIZATION";}
  if(type==="PRICE_LIST_ITEM" || type==="PRICE_LIST_PACKAGE_ITEM")
    record.unitPrice="1234.0123";
  for(const [field,shape] of Object.entries(catalogBundleNestedSourceProjections[type]))
    record[field]=nested(shape as BundleNestedProjection | readonly [BundleNestedProjection]);
  return record;
}
function batch(selected:readonly CatalogExportType[]=types){
  return {
    format:"family-lab-catalog-bundle",schemaVersion:1,
    consistency:"transactional-consistent-read",
    organizationId:uuid(),exportedAt:fixedExportAt,
    fieldContract:bundleFieldContract(selected),
    groups:selected.map(entityType=>({entityType,records:[source(entityType)]})),
  };
}
function refused(block:unknown,selected:readonly CatalogExportType[],code:string){
  assert.throws(()=>checkedAtomicCatalogReviewSource(block,selected),
    (e:unknown)=>e instanceof AtomicReviewSourceError && e.code===code,code);
}

test("F8 §87: all ten classes are accepted only as complete atomic source snapshots",()=>{
  const original=batch();
  const checked=checkedAtomicCatalogReviewSource(original,types);
  assert.equal(checked.groups.length,10);
  assert.equal(checked.consistency,"transactional-consistent-read");
  for(const group of checked.groups){
    const csv=catalogReviewCsv(group,checked.organizationId,checked.exportedAt,
      "transactional-consistent-read");
    const cells=parseReviewCsvCells(csv);
    assert.equal(cells.length,2);
    assert.ok(cells[0].includes("consistency"));
    assert.equal(cells[1][5],"transactional-consistent-read");
    assert.deepEqual(parseReviewCsvCells(xlsxReviewToCsv(catalogReviewXlsx(csv))),cells,
      group.entityType+" retains Arabic, exact decimals and historical values");
    assert.equal(cells[1][3],group.entityType);
  }
});

test("F8 §87: clinical ranges retain component identity, Arabic and precise critical bounds",()=>{
  const original=batch(["REFERENCE_INTERVAL"]);
  const record=original.groups[0].records[0];
  const checked=checkedAtomicCatalogReviewSource(original,["REFERENCE_INTERVAL"]);
  const csv=catalogReviewCsv(checked.groups[0],checked.organizationId,checked.exportedAt,
    "transactional-consistent-read");
  const [headers,row]=parseReviewCsvCells(csv);
  const at=(header:string)=>row[headers.indexOf(header)];
  assert.equal(at("component.code"),"CBC");
  assert.equal(at("component.test.code"),"CBC");
  assert.equal(at("criticalLow"),"-1.000000");
  assert.equal(at("criticalHigh"),"55.500000");
  assert.equal(at("normalTextAr"),"ضمن المجال المرجعي");
  assert.equal(at("id"),record.id);
  assert.throws(()=>parseCsvReviewFile(csv),
    (err:unknown)=>err instanceof CsvStagingError && err.reason==="csv_invalid_headers");
});

test("F8 §87: incomplete or stale field manifests and mixed-state exports fail closed",()=>{
  const chosen=["UNIT","CONTAINER"] as const;
  const good=batch(chosen);
  refused({...good,consistency:"paged-live-not-atomic"},chosen,"atomic_review_source_contract_invalid");
  refused({...good,fieldContract:undefined},chosen,"atomic_review_full_field_contract_required");
  refused({...good,fieldContract:{version:1,classes:[]}},chosen,"atomic_review_full_field_contract_invalid");
  refused({...good,exportedAt:"2026-02-30T00:00:00.000Z"},chosen,"atomic_review_source_contract_invalid");
  refused({...good,organizationId:uuid().slice(0,8)},chosen,"atomic_review_source_contract_invalid");
  refused({...good,groups:[...good.groups].reverse()},chosen,"atomic_review_group_or_order_invalid");
  refused({...good,groups:[good.groups[0]]},chosen,"atomic_review_source_contract_invalid");
  const altered=batch(chosen);
  delete altered.groups[0].records[0].ucumCode;
  refused(altered,chosen,"atomic_review_full_field_contract_invalid");
});

test("F8 §87: duplicate immutable UUIDs, missing relations and unsupported types fail closed",()=>{
  const unit=batch(["UNIT"]);
  unit.groups[0].records.push({...unit.groups[0].records[0],code:"OTHER"});
  refused(unit,["UNIT"],"atomic_review_immutable_identity_invalid");
  const bad=batch(["UNIT"]);
  bad.groups[0].records[0].id="non-uuid";
  refused(bad,["UNIT"],"atomic_review_immutable_identity_invalid");
  const x=batch(["COMPONENT"]);
  delete x.groups[0].records[0].test;
  refused(x,["COMPONENT"],"atomic_review_full_field_contract_invalid");
  const duplicate=batch(["TEST"]);
  refused(duplicate,["TEST","TEST"],"atomic_review_source_contract_invalid");
  refused(duplicate,["ANALYZER" as CatalogExportType],"atomic_review_source_contract_invalid");
});

test("F8 §87: CSV, XLSX and JSON use scoped atomic source, never mixed paged reads",()=>{
  const ui=readFileSync("src/components/catalog-configuration-export.tsx","utf8");
  const endpoint=readFileSync("src/app/api/catalog/configuration-export/bundle/route.ts","utf8");
  const api=readFileSync("src/app/api/catalog/imports/csv/route.ts","utf8");
  assert.equal(ui.includes('fetch("/api/catalog/configuration-export?"'),false);
  assert.ok(ui.includes("checkedAtomicCatalogReviewSource(await response.json(), [entityType])"));
  assert.ok(ui.includes("checkedAtomicCatalogReviewSource(JSON.parse(text), types)"));
  assert.ok(ui.includes("checkedAtomicCatalogReviewSource(source, [entityType])"));
  assert.ok(ui.includes('"transactional-consistent-read");'));
  assert.ok((ui.match(/configuration-export\/bundle\?types=/g)||[]).length>=3);
  assert.ok(endpoint.includes("RepeatableRead"));
  assert.ok(endpoint.includes("fieldContract"));
  assert.ok(ui.includes('canonicalStagingCsvFromAtomicGroup('));
  assert.ok(api.includes('status: "DRAFT", validatedAt: null'));
  for(const route of ["commit","revalidate"])
    assert.ok(readFileSync("src/app/api/catalog/imports/[id]/"+route+"/route.ts","utf8")
      .includes('batch.sourceType === "CSV_REVIEW"'));
});
