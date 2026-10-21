import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {canonicalJson,type Json} from "../src/lib/catalog-bundle-attestation.ts";
import {catalogBundleAllowedSourceFields} from "../src/lib/catalog-bundle-source-boundary.ts";
import {F2_EFFECTIVE_READ_TYPES,projectF2EffectiveCatalogView,
  resolveF2EffectiveCatalogViews,f2EffectiveCompositeMemberIds,
  f2EffectiveCompositeMembersAuthorized} from "../src/lib/catalog-f2-effective-view.ts";

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

test("F2: future panel and package memberships are only exported after CURRENT branch/department test-code checks",async()=>{
  const codes=[
    {testId:uuid(810),displayOrder:0,required:true,test:{code:"CBC"}},
    {testId:uuid(811),displayOrder:1,required:false,test:{code:"CRP"}},
  ];
  for(const kind of ["PANEL","PACKAGE"] as const){
    const entityId=uuid(kind==="PANEL"?901:902);
    const source:Record<string,unknown>={};
    for(const field of catalogBundleAllowedSourceFields[kind])source[field]=null;
    Object.assign(source,{id:entityId,code:"COMPOSITE",
      items:kind==="PANEL"?codes:codes.map(({required:_unused,...member})=>member),
    });
    const overlay=await resolveF2EffectiveCatalogViews({
      catalogConfigurationRevision:{findMany:async()=>[{
        entityId,afterSnapshot:source,desiredDigest:digest(source),
      }]},
    } as never,{organizationId,asOf:new Date("2026-11-01T00:00:00.000Z"),
      records:[{entityType:kind,id:entityId}]});
    const live=projectF2EffectiveCatalogView(kind,{
      id:entityId,items:[],nameEn:"Existing name",organizationId,
    },overlay);
    const members=f2EffectiveCompositeMemberIds(kind,[live]);
    assert.ok(members);
    assert.equal(members.size,2);
    assert.equal(members.get(uuid(810)),"CBC");
    assert.equal(f2EffectiveCompositeMembersAuthorized(members,[
      {id:uuid(810),code:"CBC"},{id:uuid(811),code:"CRP"},
    ]),true);
    assert.equal(f2EffectiveCompositeMembersAuthorized(members,[
      {id:uuid(810),code:"CBC"},
    ]),false,"out-of-department members are not silently omitted");
    assert.equal(f2EffectiveCompositeMembersAuthorized(members,[
      {id:uuid(810),code:"CBC"},{id:uuid(811),code:"SPOOF"},
    ]),false,"linked test identity codes are checked from live scoped tests");
    assert.deepEqual(live.organizationId,organizationId);
    assert.equal(live.id,entityId);
    assert.equal(f2EffectiveCompositeMemberIds(kind,[{id:entityId,
      items:[...(source.items as object[]), (source.items as object[])[0]],
    }]),null,"duplicate member ids are not allowed");
  }
  assert.equal(f2EffectiveCompositeMemberIds("PANEL",[{
    id:uuid(902),items:[{testId:uuid(810),displayOrder:0,
      required:true,test:{code:"CBC",private:true}}],
  }]),null);
});

test("F2: both export modes cross-check every revised composite member against scoped source tests",()=>{
  for(const file of [
    "src/app/api/catalog/configuration-export/bundle/route.ts",
    "src/app/api/catalog/configuration-export/route.ts",
  ]){
    const body=readFileSync(file,"utf8");
    assert.match(body,/f2EffectiveCompositeMemberIds\(type,/);
    assert.match(body,/f2EffectiveCompositeMembersAuthorized\(members,scopedTests\)/);
    assert.match(body,/tx\.labTest\.findMany\(/);
    assert.match(body,/where:\{\.\.\.testScope,id:\{in:\[\.\.\.members\.keys\(\)\]\}\}/);
  }
});
