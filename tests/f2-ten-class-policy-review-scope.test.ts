import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { catalogExportTypes } from "../src/lib/catalog-configuration-export.ts";
import { policyReviewIdentityScope, validatePolicyReviewBatchScope } from "../src/lib/catalog-policy-review-scope.ts";

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
  base("TEST",testId,{code:"F2",nameEn:"F2 Test",departmentId:branchId,status:"ACTIVE"},
    {code:"F2",nameEn:"F2 Test",departmentId:branchId,status:"ACTIVE"}),
  base("COMPONENT",componentId,{testId,unitId,code:"COMP",nameEn:"Component",
    testCode:"F2",status:"ACTIVE"},
    {testId,unitId,code:"COMP",nameEn:"Component",test:{code:"F2"},status:"ACTIVE"}),
  base("UNIT",unitId,{code:"MG",symbol:"mg/dL",status:"ACTIVE"},
    {code:"MG",symbol:"mg/dL",status:"ACTIVE"}),
  base("CONTAINER",uuid(7),{code:"TUBE",nameEn:"Tube",nameAr:null,
    tubeColor:"Red",additive:null,status:"ACTIVE"},
    {code:"TUBE",nameEn:"Tube",nameAr:null,tubeColor:"Red",additive:null,status:"ACTIVE"}),
  base("PANEL",panelId,{items:[{testId,testCode:"F2",displayOrder:1,required:true}]},
    {items:[{testId,displayOrder:1,required:true,test:{code:"F2"}}]}),
  base("PACKAGE",packageId,{items:[{testId,testCode:"F2",displayOrder:1}]},
    {items:[{testId,displayOrder:1,test:{code:"F2"}}]}),
  base("REFERENCE_INTERVAL",uuid(8),{componentId,componentCode:"COMP",
    testCode:"F2",branchId,effectiveFrom:"2026-01-01T00:00:00.000Z",
    approvalStatus:"APPROVED",status:"ACTIVE"},
    {componentId,branchId,effectiveFrom:"2026-01-01T00:00:00.000Z",
      approvalStatus:"APPROVED",status:"ACTIVE",
      component:{code:"COMP",test:{code:"F2"}}}),
  base("PRICE_LIST",listId,{code:"LIST",currency:"AED",scopeType:"BRANCH",
    branchId,status:"ACTIVE"},
    {...tariff,code:"LIST",currency:"AED",scopeType:"BRANCH",branchId,status:"ACTIVE"}),
  base("PRICE_LIST_ITEM",uuid(9),{testId,priceListId:listId,testCode:"F2",
    priceListCode:"LIST",scopeType:"BRANCH",branchId,unitPrice:"45.6700",
    effectiveFrom:"2026-01-01T00:00:00.000Z",status:"ACTIVE"},
    {testId,priceListId:listId,test:{code:"F2"},
      unitPrice:"45.6700",effectiveFrom:"2026-01-01T00:00:00.000Z",
      status:"ACTIVE",priceList:{...tariff,code:"LIST",currency:"AED",scopeType:"BRANCH",
        branchId,status:"ACTIVE"}}),
  base("PRICE_LIST_PACKAGE_ITEM",uuid(10),{priceListId:listId,priceListCode:"LIST",
    packageId,packageCode:"PACK",scopeType:"BRANCH",branchId,currency:"AED",
    unitPrice:"123.4500",effectiveFrom:"2026-01-01T00:00:00.000Z",
    effectiveTo:null,status:"ACTIVE"},
    {priceListId:listId,packageId,unitPrice:"123.4500",
      effectiveFrom:"2026-01-01T00:00:00.000Z",effectiveTo:null,status:"ACTIVE",
      package:{code:"PACK"},priceList:{...tariff,code:"LIST",scopeType:"BRANCH",
        branchId,currency:"AED"}}),
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
  assert.equal(change("TEST",x=>{(x.normalizedData as Record<string,unknown>).departmentId=uuid(71);}).ok,false);
  assert.equal(change("TEST",x=>{(x.sourceData as Record<string,unknown>).nameEn="Swapped";}).ok,false);
  assert.equal(change("TEST",x=>{delete (x.sourceData as Record<string,unknown>).departmentId;}).ok,false);
  assert.equal(change("UNIT",x=>{(x.normalizedData as Record<string,unknown>).symbol="mmol/L";}).ok,false);
  assert.equal(change("UNIT",x=>{(x.sourceData as Record<string,unknown>).code="OTHER";}).ok,false);
  assert.equal(change("CONTAINER",x=>{(x.normalizedData as Record<string,unknown>).tubeColor="Blue";}).ok,false);
  assert.equal(change("CONTAINER",x=>{(x.sourceData as Record<string,unknown>).additive="EDTA";}).ok,false);
  assert.equal(change("CONTAINER",x=>{delete (x.sourceData as Record<string,unknown>).nameAr;}).ok,false);
  assert.equal(change("CONTAINER",x=>{(x.normalizedData as Record<string,unknown>).status="INACTIVE";}).ok,false);
  assert.equal(change("PANEL",x=>{(((x.normalizedData as Record<string,unknown>).items as Record<string,unknown>[])[0]).testCode="CHANGED";}).ok,false);
  assert.equal(change("PANEL",x=>{(((x.normalizedData as Record<string,unknown>).items as Record<string,unknown>[])[0]).required=false;}).ok,false);
  assert.equal(change("PACKAGE",x=>{(((x.sourceData as Record<string,unknown>).items as Record<string,unknown>[])[0]).displayOrder=7;}).ok,false);
  assert.equal(change("PACKAGE",x=>{(((x.sourceData as Record<string,unknown>).items as Record<string,unknown>[])[0]).testId=uuid(55);}).ok,false);
  assert.equal(change("COMPONENT",x=>{(x.normalizedData as Record<string,unknown>).testId=uuid(90);}).ok,false);
  assert.equal(change("COMPONENT",x=>{(x.normalizedData as Record<string,unknown>).testCode="OTHER";}).ok,false);
  assert.equal(change("COMPONENT",x=>{(x.sourceData as Record<string,unknown>).unitId=uuid(77);}).ok,false);
  assert.equal(change("COMPONENT",x=>{(x.normalizedData as Record<string,unknown>).nameEn="Tampered";}).ok,false);
  assert.equal(change("COMPONENT",x=>{delete (x.sourceData as Record<string,unknown>).test;}).ok,false);
  assert.equal(change("REFERENCE_INTERVAL",x=>{(x.normalizedData as Record<string,unknown>).componentId=uuid(91);}).ok,false);
  assert.equal(change("REFERENCE_INTERVAL",x=>{(x.normalizedData as Record<string,unknown>).componentCode="WRONG";}).ok,false);
  assert.equal(change("REFERENCE_INTERVAL",x=>{(x.normalizedData as Record<string,unknown>).testCode="WRONG";}).ok,false);
  assert.equal(change("REFERENCE_INTERVAL",x=>{(x.normalizedData as Record<string,unknown>).branchId=uuid(55);}).ok,false);
  assert.equal(change("REFERENCE_INTERVAL",x=>{(x.normalizedData as Record<string,unknown>).effectiveFrom="2027-01-01T00:00:00.000Z";}).ok,false);
  assert.equal(change("REFERENCE_INTERVAL",x=>{(x.normalizedData as Record<string,unknown>).approvalStatus="DRAFT";}).ok,false);
  assert.equal(change("REFERENCE_INTERVAL",x=>{(x.normalizedData as Record<string,unknown>).status="INACTIVE";}).ok,false);
  assert.equal(change("REFERENCE_INTERVAL",x=>{delete (x.sourceData as Record<string,unknown>).component;}).ok,false);
  assert.equal(change("PRICE_LIST",x=>{(x.normalizedData as Record<string,unknown>).currency="USD";}).ok,false);
  assert.equal(change("PRICE_LIST",x=>{(x.normalizedData as Record<string,unknown>).code="SWAPPED";}).ok,false);
  assert.equal(change("PRICE_LIST",x=>{(x.sourceData as Record<string,unknown>).branchId=null;}).ok,false);
  assert.equal(change("PRICE_LIST_ITEM",x=>{(x.normalizedData as Record<string,unknown>).testId=uuid(42);}).ok,false);
  assert.equal(change("PRICE_LIST_ITEM",x=>{(x.normalizedData as Record<string,unknown>).testCode="OTHER";}).ok,false);
  assert.equal(change("PRICE_LIST_ITEM",x=>{(x.normalizedData as Record<string,unknown>).priceListCode="OTHER";}).ok,false);
  assert.equal(change("PRICE_LIST_ITEM",x=>{(x.normalizedData as Record<string,unknown>).unitPrice="99.0000";}).ok,false);
  assert.equal(change("PRICE_LIST_ITEM",x=>{(x.normalizedData as Record<string,unknown>).effectiveFrom="2027-01-01T00:00:00.000Z";}).ok,false);
  assert.equal(change("PRICE_LIST_ITEM",x=>{(x.sourceData as Record<string,unknown>).priceListId=uuid(42);}).ok,false);
  assert.equal(change("PRICE_LIST_ITEM",x=>{(x.sourceData as Record<string,unknown>).unitPrice="12.34567";}).ok,false);
  assert.equal(change("PRICE_LIST_ITEM",x=>{delete (x.sourceData as Record<string,unknown>).test;}).ok,false);
  assert.equal(change("PRICE_LIST_ITEM",x=>{delete (x.sourceData as Record<string,unknown>).priceList;}).ok,false);
  assert.equal(change("PRICE_LIST_PACKAGE_ITEM",x=>{(x.normalizedData as Record<string,unknown>).packageCode="OTHER";}).ok,false);
  assert.equal(change("PRICE_LIST_PACKAGE_ITEM",x=>{(x.normalizedData as Record<string,unknown>).unitPrice="200.0000";}).ok,false);
  assert.equal(change("PRICE_LIST_PACKAGE_ITEM",x=>{(x.normalizedData as Record<string,unknown>).currency="USD";}).ok,false);
  assert.equal(change("PRICE_LIST_PACKAGE_ITEM",x=>{(x.sourceData as Record<string,unknown>).priceListId=uuid(88);}).ok,false);
  assert.equal(change("PRICE_LIST_PACKAGE_ITEM",x=>{(x.normalizedData as Record<string,unknown>).effectiveFrom="2027-01-01T00:00:00.000Z";}).ok,false);
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


test("F2: reviewer transaction must reject live but in-scope PANEL/PACKAGE membership drift", async()=>{
  const currentPanels=[{testId,displayOrder:1,required:true}];
  const currentPackages=[{testId,displayOrder:1}];
  const count=async({where}:{where:{id:{in:string[]}}})=>where.id.in.length;
  const tx = {
    catalogImportRow:{findMany:async()=>all},
    labTest:{count},unit:{count},testComponent:{count},referenceInterval:{count},
    priceList:{count},priceListItem:{count},container:{count},
    priceListPackageItem:{count},
    testPanel:{count,findMany:async()=>[{id:panelId,items:[...currentPanels]}]},
    commercialPackage:{count,findMany:async()=>[{id:packageId,items:[...currentPackages]}]},
  } as unknown as Parameters<typeof validatePolicyReviewBatchScope>[0];
  const input={batchId:uuid(25),scope:{organizationId:uuid(26),branchId,
    departmentIds:[uuid(27)]},grantedBranchIds:[branchId]};
  const check=()=>validatePolicyReviewBatchScope(tx,input);
  assert.deepEqual(await check(),{ok:true});
  currentPanels[0].displayOrder=9;
  assert.deepEqual(await check(),{ok:false,error:"policy_review_batch_scope_changed"});
  currentPanels[0].displayOrder=1;
  currentPanels[0].required=false;
  assert.deepEqual(await check(),{ok:false,error:"policy_review_batch_scope_changed"});
  currentPanels[0].required=true;
  currentPackages[0].displayOrder=2;
  assert.deepEqual(await check(),{ok:false,error:"policy_review_batch_scope_changed"});
  currentPackages[0].displayOrder=1;
  currentPackages.push({testId:uuid(44),displayOrder:2});
  assert.deepEqual(await check(),{ok:false,error:"policy_review_batch_scope_changed"});
  currentPackages.pop();
  assert.deepEqual(await check(),{ok:true});
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
