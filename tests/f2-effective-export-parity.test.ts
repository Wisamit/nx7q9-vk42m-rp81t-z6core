import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {canonicalJson,type Json} from "../src/lib/catalog-bundle-attestation.ts";
import {catalogBundleAllowedSourceFields} from "../src/lib/catalog-bundle-source-boundary.ts";
import {F2_EFFECTIVE_READ_TYPES,projectF2EffectiveCatalogView,
  resolveF2EffectiveCatalogViews} from "../src/lib/catalog-f2-effective-view.ts";

const uuid=(n:number)=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const organizationId=uuid(100),priceListId=uuid(200);
const snapshot=()=>{
  const source:Record<string,unknown>={};
  for(const field of catalogBundleAllowedSourceFields.PRICE_LIST)source[field]=null;
  Object.assign(source,{
    id:priceListId,code:"GENERAL",nameEn:"Future price list name",
    scopeType:"ORGANIZATION",currency:"USD",status:"ACTIVE",
    priority:7,effectiveFrom:"2026-01-01T00:00:00.000Z",
    createdAt:"2026-01-01T00:00:00.000Z",
    updatedAt:"2026-01-01T00:00:00.000Z",
  });
  return source;
};
const digest=(v:unknown)=>createHash("sha256")
  .update(canonicalJson(v as Json)).digest("hex");

test("F2: effective price list export keeps stable identity, organization currency and old dates",async()=>{
  assert.ok(F2_EFFECTIVE_READ_TYPES.includes("PRICE_LIST"));
  const source=snapshot(),db={
    catalogConfigurationRevision:{findMany:async(args:any)=>{
      assert.equal(args.where.organizationId,organizationId);
      assert.equal(args.where.entityType,"PRICE_LIST");
      assert.equal(args.where.state,"RECORDED");
      assert.deepEqual(args.where.entityId.in,[priceListId]);
      assert.equal(args.where.effectiveFrom.lte.toISOString(),
        "2026-11-01T00:00:00.000Z");
      return [{entityId:priceListId,afterSnapshot:source,desiredDigest:digest(source)}];
    }},
  };
  const overlays=await resolveF2EffectiveCatalogViews(db as never,{
    organizationId,asOf:new Date("2026-11-01T00:00:00.000Z"),
    records:[{entityType:"PRICE_LIST",id:priceListId}],
  });
  const base={id:priceListId,code:"GENERAL",nameEn:"Original name",
    currency:"USD",priority:1,scopeType:"ORGANIZATION",
    priceListItems:[{id:uuid(300)}]};
  const effective=projectF2EffectiveCatalogView("PRICE_LIST",base,overlays);
  assert.equal(effective.nameEn,"Future price list name");
  assert.equal(effective.priority,7);
  assert.equal(effective.currency,"USD");
  assert.equal(effective.id,priceListId);
  assert.deepEqual(effective.priceListItems,base.priceListItems,
    "never replace historical/related financial records from snapshot");
  assert.equal((effective as Record<string,unknown>).createdAt,undefined,
    "historical master timestamps remain from the original Prisma entity");
});

test("F2: mismatched tenant ID, modified price-list snapshot and overlapping revisions fail closed",async()=>{
  const source=snapshot();
  async function read(records:unknown[]){
    return resolveF2EffectiveCatalogViews({
      catalogConfigurationRevision:{findMany:async()=>records},
    } as never,{organizationId,asOf:new Date("2026-11-01T00:00:00.000Z"),
      records:[{entityType:"PRICE_LIST",id:priceListId}]});
  }
  await assert.rejects(()=>read([{
    entityId:priceListId,afterSnapshot:{...source,priority:9},
    desiredDigest:digest(source),
  }]),/digest_invalid/);
  await assert.rejects(()=>read([{
    entityId:uuid(700),afterSnapshot:source,desiredDigest:digest(source),
  }]),/cross_scope/);
  await assert.rejects(()=>read([
    {entityId:priceListId,afterSnapshot:source,desiredDigest:digest(source)},
    {entityId:priceListId,afterSnapshot:source,desiredDigest:digest(source)},
  ]),/overlapping_versions/);
});

test("F2: bundle and paged configuration exports use effective snapshot after live permission checks",()=>{
  const bundle=readFileSync("src/app/api/catalog/configuration-export/bundle/route.ts","utf8");
  const paged=readFileSync("src/app/api/catalog/configuration-export/route.ts","utf8");
  for(const code of [bundle,paged]){
    assert.match(code,/liveCatalogReviewStagingAuthority\(tx,/);
    assert.match(code,/resolveF2EffectiveCatalogViews\(tx,/);
    assert.match(code,/projectF2EffectiveCatalogView\(/);
    assert.match(code,/F2_EFFECTIVE_READ_TYPES/);
    assert.match(code,/isolationLevel: "RepeatableRead"/);
    assert.match(code,/organizationId,asOf:/);
  }
  assert.ok(bundle.indexOf("liveCatalogReviewStagingAuthority(tx,")<
    bundle.indexOf("resolveF2EffectiveCatalogViews(tx,"));
  assert.ok(paged.indexOf("liveCatalogReviewStagingAuthority(tx,")<
    paged.indexOf("resolveF2EffectiveCatalogViews(tx,"));
  assert.match(bundle,/verifyBundleFieldContract\(payload\)/);
  assert.match(paged,/records: effectiveShown/);
  assert.match(bundle,/groups\.push\(\{ entityType: type, records \}\)/);
});
