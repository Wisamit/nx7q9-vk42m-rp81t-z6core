import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { catalogExportTypes } from "../src/lib/catalog-configuration-export.ts";
import { policyReviewIdentityScope } from "../src/lib/catalog-policy-review-scope.ts";

const uuid = (part: number) => "00000000-0000-4000-8000-" + part.toString(16).padStart(12,"0");
const branchId=uuid(21), testId=uuid(1), unitId=uuid(2), componentId=uuid(3);
const listId=uuid(4), packageId=uuid(5), panelId=uuid(6);
const base=(type: string, id: string, n: Record<string,unknown>={},
  source: Record<string,unknown>={})=>({
  entityType:type, status:"WARNING",importedEntityId:null,
  sourceData:{id,...source},normalizedData:{id,...n},
});
const tariff={sourceId:null,referrerId:null,clientId:null,contractId:null};
const all=[
  base("TEST",testId),
  base("COMPONENT",componentId,{testId,unitId}),
  base("UNIT",unitId),
  base("CONTAINER",uuid(7)),
  base("PANEL",panelId,{items:[{testId, testCode:"F2",displayOrder:1,required:true}]}),
  base("PACKAGE",packageId,{items:[{testId,testCode:"F2",displayOrder:1}]}),
  base("REFERENCE_INTERVAL",uuid(8),{componentId,branchId}),
  base("PRICE_LIST",listId,{scopeType:"BRANCH",branchId},tariff),
  base("PRICE_LIST_ITEM",uuid(9),{testId,priceListId:listId,scopeType:"BRANCH",branchId},
    {priceList:tariff}),
  base("PRICE_LIST_PACKAGE_ITEM",uuid(10),{priceListId:listId,packageId,scopeType:"BRANCH",branchId},
    {priceList:tariff}),
];

test("F2: every selected export class participates in policy draft reviewer scope, including nested member and priced package refs",()=>{
  assert.deepEqual(new Set(all.map(x=>x.entityType)),catalogExportTypes);
  const result=policyReviewIdentityScope(all,new Set([branchId]));
  assert.equal(result.ok,true);
  if(!result.ok)return;
  assert.equal(result.refs.tests.has(testId),true);
  assert.equal(result.refs.packages.has(packageId),true);
  assert.equal(result.refs.lists.has(listId),true);
  assert.deepEqual(result.ids.get("PANEL"),[panelId]);
  assert.deepEqual(result.ids.get("PRICE_LIST_PACKAGE_ITEM"),[uuid(10)]);
  assert.equal("sourceData" in result,false);
});

test("F2: membership, priced package, branch, private tariff and unknown source fail closed",()=>{
  const change=(type:string,alter:(a:typeof all[number])=>void)=>{
    const copy=structuredClone(all);
    const row=copy.find(x=>x.entityType===type)!;
    alter(row);
    return policyReviewIdentityScope(copy,new Set([branchId]));
  };
  assert.deepEqual(policyReviewIdentityScope(all,new Set()),{
    ok:false,error:"policy_review_batch_scope_changed",
  });
  assert.equal(change("PANEL",x=>{(x.normalizedData as Record<string,unknown>).items=[];}).ok,false);
  assert.equal(change("PACKAGE",x=>{(x.normalizedData as Record<string,unknown>).items=[{testId:"wrong"}];}).ok,false);
  assert.equal(change("PANEL",x=>{(x.normalizedData as Record<string,unknown>).items=[
    {testId},{testId}];}).ok,false);
  assert.equal(change("PRICE_LIST_PACKAGE_ITEM",x=>{(x.normalizedData as Record<string,unknown>).packageId="bad";}).ok,false);
  assert.equal(change("PRICE_LIST_PACKAGE_ITEM",x=>{(x.normalizedData as Record<string,unknown>).scopeType="CLIENT";}).ok,false);
  assert.equal(change("PRICE_LIST_PACKAGE_ITEM",x=>{((x.sourceData as Record<string,unknown>).priceList as Record<string,unknown>).contractId=uuid(22);}).ok,false);
  assert.equal(change("PRICE_LIST_ITEM",x=>{((x.sourceData as Record<string,unknown>).priceList as Record<string,unknown>).clientId=uuid(23);}).ok,false);
  assert.equal(change("PRICE_LIST",x=>{(x.sourceData as Record<string,unknown>).sourceId=uuid(24);}).ok,false);
  assert.equal(change("CONTAINER",x=>{x.sourceData.id="wrong";}).ok,false);
  assert.equal(policyReviewIdentityScope([...all,base("INVOICE",uuid(25))],new Set([branchId])).ok,false);
});

test("F2: policy queue and reviewer POST enforce the SAME tenant-locked all-type checks, never mutate masters",()=>{
  const code=readFileSync("src/lib/catalog-policy-review-scope.ts","utf8");
  const endpoint=readFileSync("src/app/api/catalog/imports/[id]/policy-review/route.ts","utf8");
  const queue=readFileSync("src/app/api/catalog/imports/policy-review-queue/route.ts","utf8");
  for(const name of ["labTest","unit","testComponent","referenceInterval","priceList","priceListItem",
    "container","testPanel","commercialPackage","priceListPackageItem"]){
    assert.match(code,new RegExp("tx\\."+name+"\\.count\\("),name);
  }
  for(const name of ["sourceId","referrerId","clientId","contractId"])
    assert.match(code,new RegExp(name+": null"));
  assert.match(code,/every: \{ test: testScope \}/);
  assert.match(code,/refs\.packages/);
  assert.match(endpoint,/validatePolicyReviewBatchScope\(tx/);
  assert.match(queue,/validatePolicyReviewBatchScope\(tx/);
  assert.doesNotMatch(code,/tx\.(?:labTest|unit|testPanel|commercialPackage|priceList|priceListPackageItem)\.(?:create|update|upsert|delete)/);
});
