import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {canonicalJson,type Json} from "../src/lib/catalog-bundle-attestation.ts";
import {catalogBundleAllowedSourceFields} from "../src/lib/catalog-bundle-source-boundary.ts";
import {
  projectF2EffectiveCatalogView,resolveF2EffectiveCatalogViews,
} from "../src/lib/catalog-f2-effective-view.ts";

const id=(i:number)=>"00000000-0000-4000-8000-"+String(i).padStart(12,"0");
const organizationId=id(1);
const digest=(data:unknown)=>createHash("sha256")
  .update(canonicalJson(data as Json)).digest("hex");
function source(type:"TEST"|"COMPONENT"|"UNIT"|"CONTAINER",targetId:string){
  const result:Record<string,unknown>={};
  for(const field of catalogBundleAllowedSourceFields[type])result[field]=null;
  result.id=targetId;result.code="TEST";result.nameEn="Effective name";
  result.createdAt="2026-01-01T00:00:00.000Z";
  result.updatedAt="2026-01-01T00:00:00.000Z";
  return result;
}
test("F2: tenant-scoped, bounded as-of reads return effective metadata but not future/cancelled snapshots",async()=>{
  const testId=id(2),componentId=id(3);
  const testData=source("TEST",testId);
  const componentData=source("COMPONENT",componentId);
  const args:unknown[]=[];
  const db={catalogConfigurationRevision:{
    findMany:async(input:any)=>{
      args.push(input);
      if(input.where.entityType==="TEST")return [{
        entityId:testId,afterSnapshot:testData,desiredDigest:digest(testData),
      }];
      if(input.where.entityType==="COMPONENT")return [{
        entityId:componentId,afterSnapshot:componentData,
        desiredDigest:digest(componentData),
      }];
      return [];
    },
  }};
  const view=await resolveF2EffectiveCatalogViews(db as never,{
    organizationId,asOf:new Date("2026-11-01T00:00:00.000Z"),
    records:[{entityType:"TEST",id:testId},{entityType:"COMPONENT",id:componentId}],
  });
  assert.equal(view.size,2);
  assert.equal((args[0] as any).where.organizationId,organizationId);
  assert.equal((args[0] as any).where.state,"RECORDED");
  assert.equal((args[0] as any).where.effectiveFrom.lte.toISOString(),
    "2026-11-01T00:00:00.000Z");
  assert.deepEqual((args[0] as any).where.OR,
    [{effectiveTo:null},{effectiveTo:{gt:new Date("2026-11-01T00:00:00.000Z")} }]);
  const base={id:testId,nameEn:"Old name",department:{id:id(12)},
    components:[{id:componentId,reportNameEn:"Old report"}]};
  const revised=projectF2EffectiveCatalogView("TEST",base,view);
  assert.equal(revised.nameEn,"Effective name");
  assert.deepEqual(revised.department,base.department);
  assert.deepEqual(revised.components,base.components);
  assert.equal(revised.id,testId);
  assert.equal((revised as Record<string,unknown>).test,undefined);
  const zero=await resolveF2EffectiveCatalogViews(db as never,{
    organizationId,asOf:new Date("2026-11-01"),records:[],
  });
  assert.equal(zero.size,0);
});
test("F2: reject forged values, digest mismatch, overlaps and foreign UUID disclosure",async()=>{
  const target=id(8),data=source("TEST",target);
  async function call(revisions:any[]){
    return resolveF2EffectiveCatalogViews({
      catalogConfigurationRevision:{findMany:async()=>revisions},
    } as never,{
      organizationId,asOf:new Date("2026-11-01T00:00:00.000Z"),
      records:[{entityType:"TEST",id:target}],
    });
  }
  await assert.rejects(()=>call([{entityId:target,
    afterSnapshot:{...data,nameEn:"TAMPER"},desiredDigest:digest(data)}]),/digest_invalid/);
  await assert.rejects(()=>call([{entityId:id(100),
    afterSnapshot:data,desiredDigest:digest(data)}]),/cross_scope/);
  await assert.rejects(()=>call([{entityId:target,
    afterSnapshot:{...data,unauthorized:true},
    desiredDigest:digest({...data,unauthorized:true})}]),/snapshot_invalid/);
  await assert.rejects(()=>call([{
    entityId:target,afterSnapshot:data,desiredDigest:digest(data),
  },{
    entityId:target,afterSnapshot:data,desiredDigest:digest(data),
  }]),/overlapping_versions/);
  await assert.rejects(()=>resolveF2EffectiveCatalogViews({
    catalogConfigurationRevision:{findMany:async()=>{throw Error("query must not occur");}},
  } as never,{
    organizationId,asOf:new Date("2026-11-01"),
    records:[{entityType:"TEST",id:target},{entityType:"TEST",id:target}],
  }),/duplicate_target/);
});
test("F2: effective overlays are consumed by existing catalog GET within a consistent read transaction",()=>{
  const route=readFileSync("src/app/api/catalog/tests/route.ts","utf8");
  assert.match(route,/resolveF2EffectiveCatalogViews\(tx,/);
  assert.match(route,/projectF2EffectiveCatalogView\("TEST"/);
  assert.match(route,/projectF2EffectiveCatalogView\("COMPONENT"/);
  assert.match(route,/projectF2EffectiveCatalogView\("CONTAINER"/);
  assert.match(route,/projectF2EffectiveCatalogView\("UNIT"/);
  assert.match(route,/isolationLevel:"RepeatableRead"/);
  assert.match(route,/where:\{organizationId\}/);
});

test("F2: catalog administration SSR reads effective master fields and only effective visible package tariffs",()=>{
  const page=readFileSync("src/app/catalog/page.tsx","utf8");
  assert.match(page,/prisma\.\$transaction\(async tx=>/);
  assert.match(page,/resolveF2EffectiveCatalogViews\(tx,/);
  assert.match(page,/projectF2EffectiveCatalogView\("TEST"/);
  assert.match(page,/projectF2EffectiveCatalogView\("COMPONENT"/);
  assert.match(page,/projectF2EffectiveCatalogView\("CONTAINER"/);
  assert.match(page,/projectF2EffectiveCatalogView\("UNIT"/);
  assert.match(page,/effectiveFrom: \{ lte: asOf \}/);
  assert.match(page,/effectiveTo: \{ gt: asOf \}/);
  assert.match(page,/isolationLevel:"RepeatableRead"/);
  assert.match(page,/\.filter\(unit=>unit\.status==="ACTIVE"\)/);
  assert.match(page,/\.filter\(container=>container\.status==="ACTIVE"\)/);
});
