import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {
  f2EffectiveCompositeMemberIds,f2EffectiveCompositeMembersAuthorized,
} from "../src/lib/catalog-f2-effective-view.ts";

const id=(n:number)=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");

test("F2: new order package membership is its currently effective signed revision",()=>{
  const route=readFileSync("src/app/api/orders/route.ts","utf8");
  for(const name of [
    "resolveF2EffectiveCatalogViews","projectF2EffectiveCatalogView",
    "f2EffectiveCompositeMemberIds","f2EffectiveCompositeMembersAuthorized",
    "effectiveMemberships","eligibleTests","packageTestOwner",
  ])assert.match(route,new RegExp(name));
  assert.match(route,/entityType:"PACKAGE" as const/);
  assert.match(route,/asOf:catalogAsOf/);
  assert.match(route,/pkg\.status!=="ACTIVE"/);
  assert.match(route,/status:"ACTIVE"/);
  assert.match(route,/effective_package_membership_scope_changed/);
  assert.match(route,/const orderQuestionAsOf = catalogAsOf/);
  assert.ok(route.indexOf("const effectiveMemberships=")<
    route.indexOf("const packageTestOwner ="));
  assert.ok(route.indexOf("const packageTestOwner =")<
    route.indexOf("const allTestIds ="));
  assert.doesNotMatch(route,/sourceInstallationVerified:true|request\.json\(\).*f2/);
});

test("F2: effective package member codes and identity cannot be quietly remapped",()=>{
  const first=id(11),second=id(12);
  const payload={id:id(1),items:[
    {testId:first,displayOrder:1,test:{code:"T-A"}},
    {testId:second,displayOrder:2,test:{code:"T-B"}},
  ]};
  const members=f2EffectiveCompositeMemberIds("PACKAGE",[payload]);
  assert.ok(members);
  assert.equal(members.size,2);
  assert.equal(f2EffectiveCompositeMembersAuthorized(members,[
    {id:first,code:"T-A"},{id:second,code:"T-B"},
  ]),true);
  assert.equal(f2EffectiveCompositeMembersAuthorized(members,[
    {id:first,code:"T-A"},
  ]),false,"newly effective extra member must exist and be active");
  assert.equal(f2EffectiveCompositeMembersAuthorized(members,[
    {id:first,code:"T-A"},{id:second,code:"T-X"},
  ]),false,"code mismatch must reject instead of using stale legacy membership");
  assert.equal(f2EffectiveCompositeMemberIds("PACKAGE",[
    {...payload,items:[payload.items[0],payload.items[0]]},
  ]),null);
  assert.equal(f2EffectiveCompositeMemberIds("PACKAGE",[
    {...payload,items:[{testId:first,displayOrder:1,test:{code:"T-A"},unknown:true}]},
  ]),null);
});

test("F2: new order snapshots capture effective test and unit display values, preserving Decimal type",()=>{
  const route=readFileSync("src/app/api/orders/route.ts","utf8");
  assert.match(route,/const \[patient, storedTests, source/);
  assert.match(route,/const orderTestOverlays=await resolveF2EffectiveCatalogViews\(/);
  assert.match(route,/entityType:"TEST" as const/);
  assert.match(route,/entityType:"UNIT" as const/);
  assert.match(route,/projectF2EffectiveCatalogView\("TEST",test,orderTestOverlays\)/);
  assert.match(route,/projectF2EffectiveCatalogView\("UNIT",test\.defaultUnit,orderTestOverlays\)/);
  assert.match(route,/new Prisma\.Decimal\(effective\.minimumVolume\)/);
  assert.match(route,/test_not_active_at_order_time/);
  assert.match(route,/testNameEnSnapshot: test\.nameEn/);
  assert.match(route,/testNameArSnapshot: test\.nameAr/);
  assert.match(route,/unitSnapshot: test\.defaultUnit\?\.symbol/);
  assert.ok(route.indexOf("const orderTestOverlays=")<route.indexOf("const tests=storedTests.map"));
  assert.ok(route.indexOf("const tests=storedTests.map")<route.indexOf("for (const test of tests)"));
});

test("F2: reject duplicate display positions and case-insensitive repeated test UUIDs in effective composite members",()=>{
  const alpha="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const another="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const valid={id:id(1),items:[
    {testId:alpha,displayOrder:1,test:{code:"ALPHA"}},
    {testId:another,displayOrder:2,test:{code:"BETA"}},
  ]};
  const members=f2EffectiveCompositeMemberIds("PACKAGE",[valid]);
  assert.ok(members);
  assert.deepEqual([...members.keys()],[alpha,another]);
  assert.equal(f2EffectiveCompositeMembersAuthorized(members,[
    {id:alpha.toUpperCase(),code:"ALPHA"},
    {id:another.toUpperCase(),code:"BETA"},
  ]),true,"database UUID letter-case must not prevent legitimate scope checks");
  assert.equal(f2EffectiveCompositeMembersAuthorized(members,[
    {id:alpha,code:"ALPHA"},
    {id:alpha.toUpperCase(),code:"ALPHA"},
  ]),false,"one real test cannot be authorized as two separate members");
  assert.equal(f2EffectiveCompositeMemberIds("PACKAGE",[{
    ...valid,items:[valid.items[0],{...valid.items[1],displayOrder:1}],
  }]),null,"duplicate order positions can produce ambiguous report/order line ordering");
  assert.equal(f2EffectiveCompositeMemberIds("PACKAGE",[{
    ...valid,items:[valid.items[0],{...valid.items[1],testId:alpha.toUpperCase()}],
  }]),null,"case-only duplicate UUIDs refer to the same immutable lab test");
  assert.equal(f2EffectiveCompositeMemberIds("PANEL",[{
    id:id(2),items:[
      {testId:alpha,displayOrder:1,required:true,test:{code:"ALPHA"}},
      {testId:another,displayOrder:1,required:false,test:{code:"BETA"}},
    ],
  }]),null,"panel display ordering must be unambiguous as well");
});
