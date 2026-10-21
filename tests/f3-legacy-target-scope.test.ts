import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {f3MappedTargetsCurrentlyScoped}
  from "../src/lib/f3-legacy-target-scope.ts";
import type {F3LineageDecision}
  from "../src/lib/f3-legacy-source-reconciliation.ts";

const uuid=(n:number)=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const org=uuid(1),branches=[uuid(2),uuid(3)];
const record=(sourceTable:string,targetType:string,targetId:string,
  n=1):F3LineageDecision=>({
  organizationId:org,sourceSha256:"a".repeat(64),digestKeyId:"b".repeat(64),
  sourceTable,sourceSchemaSha256:"c".repeat(64),
  rowDigest:"d".repeat(64),occurrence:n,
  classification:"APPROVED_MAPPING",targetType,targetId,
});
const verified=(tx:unknown,lineage:readonly F3LineageDecision[])=>
  f3MappedTargetsCurrentlyScoped(tx as never,{
    organizationId:org,activeBranchIds:branches,lineage,
  });

test("F3: source-target type, tenant and branch filters are rechecked in live SQL",async()=>{
  const calls:Array<{model:string;args:any}>=[];
  const query=(model:string)=>(async(args:any)=>{
    calls.push({model,args});return args.where.id.in.map((id:string)=>({id}));
  });
  const tx={
    labTest:{findMany:query("labTest")},
    referenceInterval:{findMany:query("referenceInterval")},
    priceListItem:{findMany:query("priceListItem")},
    testPanel:{findMany:query("testPanel")},
    orderSource:{findMany:query("orderSource")},
  };
  const rows=[
    record("Test name","TEST",uuid(10)),
    record("normal","REFERENCE_INTERVAL",uuid(20)),
    record("price","PRICE_LIST_ITEM",uuid(30)),
    record("Gropes","PANEL",uuid(40)),
    record("Source","SOURCE",uuid(50)),
  ];
  assert.equal(await verified(tx,rows),true);
  assert.deepEqual(calls.map(c=>c.model),[
    "labTest","referenceInterval","priceListItem","testPanel","orderSource"]);
  assert.equal(calls[0].args.where.organizationId,org);
  assert.equal(calls[0].args.where.status,"ACTIVE");
  assert.equal(calls[1].args.where.component.test.organizationId,org);
  const tariff=calls[2].args.where.priceList;
  assert.equal(tariff.organizationId,org);
  assert.deepEqual(tariff.OR[1].branchId.in,branches);
  assert.equal(calls[3].args.where.organizationId,org);
  assert.equal(calls[4].args.where.organizationId,org);
});

test("F3: missing, wrong-tenant, wrong-class, and forged SQL rows reject",async()=>{
  const testId=uuid(10);
  const good=record("Test name","TEST",testId);
  const missing={labTest:{findMany:async()=>[]}};
  assert.equal(await verified(missing,[good]),false);
  const forged={labTest:{findMany:async()=>[{id:uuid(90)}]}};
  assert.equal(await verified(forged,[good]),false);
  const duplicate={labTest:{findMany:async()=>[{id:testId},{id:testId}]}};
  assert.equal(await verified(duplicate,[good]),false);
  const touched={labTest:{findMany:async()=>{throw Error("SQL should not run");}}};
  assert.equal(await verified(touched,[{...good,organizationId:uuid(99)}]),false);
  assert.equal(await verified(touched,[{...good,targetType:"PRICE_LIST_ITEM"}]),false);
  assert.equal(await verified(touched,[{...good,targetId:"not-a-uuid"}]),false);
  assert.equal(await verified(touched,[{...good,targetType:"GROUP"}]),false);
  assert.equal(await f3MappedTargetsCurrentlyScoped(touched as never,{
    organizationId:org,activeBranchIds:[],lineage:[good],
  }),false);
});

test("F3: 251 mapped source rows use two bounded queries, repeated target UUIDs use one",async()=>{
  const hits:number[]=[];
  const tx={labTest:{findMany:async(args:{where:{id:{in:string[]}}})=>{
    hits.push(args.where.id.in.length);
    return args.where.id.in.map(id=>({id}));
  }}};
  const many=Array.from({length:251},(_,i)=>record(
    "Test name","TEST",uuid(200+i),i+1));
  assert.equal(await verified(tx,many),true);
  assert.deepEqual(hits,[250,1]);
  hits.length=0;
  assert.equal(await verified(tx,[many[0],{...many[0],occurrence:2}]),true);
  assert.deepEqual(hits,[1],"multiple source rows can validly reference one local target");
});

test("F3: reconcile route checks current org-wide grants and targets under the SAME tenant lock",()=>{
  const route=readFileSync(
    "src/app/api/catalog/legacy-row-lineage/reconcile/route.ts","utf8");
  assert.match(route,/FOR UPDATE/);
  assert.match(route,/isolationLevel:"RepeatableRead"/);
  assert.match(route,/originalBranches\.size!==branches\.length/);
  assert.match(route,/scoped\.size!==branches\.length/);
  assert.match(route,/f3MappedTargetsCurrentlyScoped\(tx,/);
  assert.match(route,/activeBranchIds:branches\.map\(branch=>branch\.id\)/);
  assert.match(route,/f3_mapped_target_scope_missing_or_revoked/);
  assert.ok(route.indexOf("reconcileF3LegacySource({")<
    route.indexOf("f3MappedTargetsCurrentlyScoped(tx,"));
  assert.ok(route.indexOf("f3MappedTargetsCurrentlyScoped(tx,")<
    route.indexOf("await tx.auditEvent.create({data:"));
  assert.doesNotMatch(route,/(?:tx|prisma)\.(?:labTest|patient|order|laboratoryResult)\.(?:update|create|upsert|delete)\(/);
});
