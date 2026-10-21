import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {f3LiveLineageTargetsVisible}
  from "../src/lib/f3-legacy-target-visibility.ts";
import type {F3LineageDecision}
  from "../src/lib/f3-legacy-source-reconciliation.ts";

const id=(n:number)=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const org=id(1);
const row=(sourceTable:string,targetType:string,targetId:string):F3LineageDecision=>({
  organizationId:org,sourceSha256:"a".repeat(64),
  digestKeyId:"b".repeat(64),sourceTable,
  sourceSchemaSha256:"c".repeat(64),rowDigest:"d".repeat(64),
  occurrence:1,classification:"MAPPED",targetType,targetId,
});
test("F3: target existence verification batches IDs by class and validates org/parent relationships",async()=>{
  const calls:Array<{kind:string;where:Record<string,unknown>}>=[],records=[
    row("Test name","TEST",id(11)),
    row("Test name","TEST",id(12)),
    row("normal","REFERENCE_INTERVAL",id(13)),
    row("price","PRICE_LIST_ITEM",id(14)),
    row("Referdby","REFERRER",id(15)),
  ];
  function handler(kind:string) {
    return async({where}:{where:{id:{in:string[]};[key:string]:unknown}})=>{
      calls.push({kind,where});
      return where.id.in.map((item:string)=>({id:item}));
    };
  }
  const db={
    labTest:{findMany:handler("TEST")},
    referenceInterval:{findMany:handler("REFERENCE_INTERVAL")},
    priceListItem:{findMany:handler("PRICE_LIST_ITEM")},
    referrer:{findMany:handler("REFERRER")},
  };
  const readOrder:string[]=[];
  const watched=records.map((record,index)=>new Proxy(record,{
    get(object,field,receiver){
      if(typeof field==="string")readOrder.push(index+":"+field);
      return Reflect.get(object,field,receiver);
    },
  }));
  const ok=await f3LiveLineageTargetsVisible(db as never,{
    organizationId:org,lineage:watched,
    currentOrganizationScopeVerified:true,
  });
  assert.equal(ok,true,JSON.stringify({calls,records,readOrder}));
  assert.equal(calls.length,4,"group two TEST mappings into a single SQL lookup");
  const tests=calls.find(c=>c.kind==="TEST");
  assert.deepEqual(tests?.where.id,{in:[id(11),id(12)]});
  assert.equal(tests?.where.organizationId,org);
  const clinical=calls.find(c=>c.kind==="REFERENCE_INTERVAL");
  assert.deepEqual(clinical?.where.component,{test:{organizationId:org}});
  const price=calls.find(c=>c.kind==="PRICE_LIST_ITEM");
  assert.deepEqual(price?.where.priceList,{organizationId:org});
  assert.deepEqual(price?.where.test,{organizationId:org});
});
test("F3: missing, foreign, duplicated or unverified target never yields false parity",async()=>{
  const original=row("Test name","TEST",id(11));
  let lookups=0;
  const db={labTest:{findMany:async()=>{
    lookups++;return [];
  }}};
  assert.equal(await f3LiveLineageTargetsVisible(db as never,{
    organizationId:org,lineage:[original],
    currentOrganizationScopeVerified:true,
  }),false);
  assert.equal(lookups,1,"missing mapped target must be looked up before rejection");
  lookups=0;
  assert.equal(await f3LiveLineageTargetsVisible(db as never,{
    organizationId:org,lineage:[{...original,organizationId:id(2)}],
    currentOrganizationScopeVerified:true,
  }),false);
  assert.equal(await f3LiveLineageTargetsVisible(db as never,{
    organizationId:org,lineage:[original],
    currentOrganizationScopeVerified:false as true,
  }),false);
  assert.equal(await f3LiveLineageTargetsVisible(db as never,{
    organizationId:org,lineage:[{...original,targetType:"UNKNOWN"}],
    currentOrganizationScopeVerified:true,
  }),false);
  assert.equal(lookups,0);
  const returnsDuplicated={labTest:{findMany:async()=>[
    {id:id(11)},{id:id(11)},
  ]}};
  assert.equal(await f3LiveLineageTargetsVisible(returnsDuplicated as never,{
    organizationId:org,lineage:[original,{...original,targetId:id(12)}],
    currentOrganizationScopeVerified:true,
  }),false);
});
test("F3: authenticated reconciliation API requires fresh organization permissions and live target visibility",()=>{
  const route=readFileSync(
    "src/app/api/catalog/legacy-row-lineage/reconcile/route.ts","utf8");
  assert.match(route,/getCurrentSession\(\)/);
  assert.match(route,/catalog\.manage/);
  assert.match(route,/pricing\.manage/);
  assert.match(route,/catalog\.reference_ranges\.manage/);
  assert.match(route,/SELECT id FROM organizations/);
  assert.match(route,/FOR UPDATE/);
  assert.match(route,/originalBranches\.size!==branches\.length/);
  assert.match(route,/departments!==0/);
  assert.match(route,/parseF3UnverifiedDigestManifest\(/);
  assert.match(route,/legacyCatalogRowLineage\.findMany\(/);
  assert.match(route,/f3LiveLineageTargetsVisible\(tx,/);
  assert.match(route,/reconcileF3LegacySource\(/);
  assert.match(route,/isolationLevel:"RepeatableRead"/);
  assert.match(route,/F3_LEGACY_DIGEST_RECONCILIATION_REVIEWED/);
  assert.doesNotMatch(route,/tx\.(?:labTest|priceListItem|referenceInterval)\.(?:create|update|upsert|delete)/);
});
