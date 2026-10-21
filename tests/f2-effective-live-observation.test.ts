import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {catalogBundleAllowedSourceFields} from "../src/lib/catalog-bundle-source-boundary.ts";
import {canonicalJson,type Json} from "../src/lib/catalog-bundle-attestation.ts";
import {readF2EffectiveLiveObservations} from "../src/lib/catalog-f2-effective-live-observation.ts";
import type {CatalogExportType} from "../src/lib/catalog-configuration-export.ts";

const org="00000000-0000-4000-8000-000000000001";
const unit="00000000-0000-4000-8000-000000000004";
const digest=(value:unknown)=>createHash("sha256")
  .update(canonicalJson(value as Json)).digest("hex");
const original=()=>{
  const data:Record<string,unknown>={};
  for(const field of catalogBundleAllowedSourceFields.UNIT)data[field]=null;
  return Object.assign(data,{
    id:unit,code:"mg_dl",nameEn:"Old unit",symbol:"mg/dL",
    status:"ACTIVE",createdAt:"2026-01-01T00:00:00.000Z",
    updatedAt:"2026-01-01T00:00:00.000Z",
  });
};
const desired=()=>({...original(),nameEn:"Revised effective unit"});
const ids=new Map<CatalogExportType,string[]>([["UNIT",[unit]]]);

test("F2: repeated import sees the same effective unit fields as the exported configuration",async()=>{
  const source=desired();
  let overlayRead=false;
  const db={
    unit:{findMany:async({where}:{where:{organizationId:string}})=>{
      assert.equal(where.organizationId,org);
      return [original()];
    }},
    catalogConfigurationRevision:{
      findMany:async({where}:{where:{
        organizationId:string;entityType:string;entityId:{in:string[]};
        effectiveFrom:{lte:Date};state:string;
      }})=>{
        assert.equal(where.organizationId,org);
        assert.equal(where.entityType,"UNIT");
        assert.deepEqual(where.entityId.in,[unit]);
        assert.equal(where.state,"RECORDED");
        overlayRead=true;
        return where.effectiveFrom.lte.getTime()>=
          Date.parse("2026-11-01T00:00:00.000Z") ?
          [{entityId:unit,afterSnapshot:source,desiredDigest:digest(source)}] : [];
      },
    },
  };
  const asOf=new Date("2026-11-01T00:00:00.000Z");
  const current=await readF2EffectiveLiveObservations(db as never,
    {organizationId:org} as never,[],ids,asOf);
  assert.ok(current);
  assert.equal(overlayRead,true);
  assert.deepEqual(current.get("UNIT:"+unit),source);
  assert.equal(current.get("UNIT:"+unit)!==original(),true);
  const before=await readF2EffectiveLiveObservations(db as never,
    {organizationId:org} as never,[],ids,new Date("2026-10-01T00:00:00.000Z"));
  assert.deepEqual(before?.get("UNIT:"+unit),original(),
    "future configuration must remain invisible before effective date");
});

test("F2: no unauthorized master can obtain an overlay before branch/department-scoped base read",async()=>{
  let overlaysQueried=false;
  const db={
    unit:{findMany:async()=>[]},
    catalogConfigurationRevision:{findMany:async()=>{
      overlaysQueried=true;throw Error("must not query a revision of an unseen master");
    }},
  };
  const current=await readF2EffectiveLiveObservations(db as never,
    {organizationId:org} as never,[],ids,new Date("2026-11-01T00:00:00.000Z"));
  assert.equal(current,null);
  assert.equal(overlaysQueried,false);
  const bad=new Map<CatalogExportType,string[]>([["UNIT",["bad-id"]]]);
  const rejected=await readF2EffectiveLiveObservations(db as never,
    {organizationId:org} as never,[],bad,new Date("2026-11-01T00:00:00.000Z"));
  assert.equal(rejected,null);
  assert.equal(overlaysQueried,false);
});

test("F2: reject corrupted future revision before deriving any second-bundle approval snapshot",async()=>{
  const altered={...desired(),nameEn:"TAMPERED"};
  const db={
    unit:{findMany:async()=>[original()]},
    catalogConfigurationRevision:{findMany:async()=>[{
      entityId:unit,afterSnapshot:altered,desiredDigest:digest(desired()),
    }]},
  };
  await assert.rejects(()=>readF2EffectiveLiveObservations(db as never,
    {organizationId:org} as never,[],ids,new Date("2026-11-01T00:00:00.000Z")),
    /f2_effective_snapshot_digest_invalid/);
});
