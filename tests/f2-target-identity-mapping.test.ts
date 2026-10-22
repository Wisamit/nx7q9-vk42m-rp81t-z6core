import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { observeCatalogTargetIdentity } from "../src/lib/catalog-bundle-target-identity.ts";
import { catalogExportTypes } from "../src/lib/catalog-configuration-export.ts";

const id=(n:number)=>"00000000-0000-4000-8000-"+n.toString(16).padStart(12,"0");
const privateLinks={sourceId:null,referrerId:null,clientId:null,contractId:null};
const parent={code:"LIST",scopeType:"BRANCH",currency:"AED",branchId:id(5),
  ...privateLinks,status:"ACTIVE"};
const member={testId:id(10),displayOrder:1,test:{code:"TEST"}};
const records={
  TEST:{id:id(1),code:"TEST",departmentId:id(5),specimenTypeId:null,
    containerId:null,methodId:null,defaultUnitId:null,nameEn:"Synthetic test"},
  COMPONENT:{id:id(2),code:"COMP",testId:id(1),unitId:id(3),
    resultSectionId:null,test:{code:"TEST"},unit:{code:"U",symbol:"mg/dL"}},
  UNIT:{id:id(3),code:"U",ucumCode:null,symbol:"mg/dL"},
  CONTAINER:{id:id(4),code:"TUBE",tubeColor:"Red"},
  PANEL:{id:id(6),code:"PANEL",items:[{...member,required:true}]},
  PACKAGE:{id:id(7),code:"PACK",items:[member]},
  REFERENCE_INTERVAL:{id:id(8),componentId:id(2),branchId:id(5),
    methodId:null,analyzerId:null,specimenTypeId:null,
    component:{code:"COMP",test:{code:"TEST"}},criticalHigh:"9.000000"},
  PRICE_LIST:{id:id(9),...parent,unitPrice:"45.6700"},
  PRICE_LIST_ITEM:{id:id(11),testId:id(1),priceListId:id(9),
    test:{code:"TEST"},priceList:parent,unitPrice:"45.6700"},
  PRICE_LIST_PACKAGE_ITEM:{id:id(12),packageId:id(7),priceListId:id(9),
    package:{code:"PACK"},priceList:parent,unitPrice:"123.4500"},
};
const source=(type:keyof typeof records)=>structuredClone(records[type]) as Record<string,unknown>;
const observe=(type:keyof typeof records,s:unknown=source(type),l:unknown=source(type))=>
  observeCatalogTargetIdentity(type,s,l);
const reject=(type:keyof typeof records,mut:(r:Record<string,unknown>)=>void,
  reason:string)=>{
  const live=source(type);mut(live);
  const result=observe(type,source(type),live);
  assert.equal(result.status,"MAPPING_REQUIRED",type);
  assert.ok(result.reasons.includes(reason as never),type+":"+reason);
  assert.equal(result.autoApplyAllowed,false);
};

test("F2: all ten types match existing local target identity, never establish portable IDs",()=>{
  assert.equal(catalogExportTypes.size,10);
  assert.deepEqual(new Set(Object.keys(records)),catalogExportTypes);
  for(const type of Object.keys(records) as Array<keyof typeof records>){
    const result=observe(type);
    assert.deepEqual(result,{
      status:"LOCAL_IDENTITY_OBSERVED",reasons:[],sourceInstanceProven:false,
      portableSourceIds:false,mappingApproved:false,reviewOnly:true,autoApplyAllowed:false,
    },type);
  }
});
test("F2: same UUID with changed natural codes is NOT a mapped target",()=>{
  for(const type of ["TEST","COMPONENT","UNIT","CONTAINER","PANEL","PACKAGE",
    "PRICE_LIST"] as const){
    reject(type,x=>{x.code="REUSED_CODE";},"PRIMARY_CODE_MISMATCH");
  }
  reject("REFERENCE_INTERVAL",x=>{x.component={code:"OTHER",test:{code:"TEST"}};},"PARENT_IDENTITY_MISMATCH");
  reject("PRICE_LIST_ITEM",x=>{x.test={code:"OTHER"};},"PARENT_IDENTITY_MISMATCH");
  reject("PRICE_LIST_PACKAGE_ITEM",x=>{x.package={code:"OTHER"};},"PARENT_IDENTITY_MISMATCH");
  reject("TEST",x=>{x.id=id(99);},"TARGET_RECORD_ID_MISMATCH");
});
test("F2: changed branch, analyte parent, unit, currency or private tariff scopes require separate mapping",()=>{
  reject("TEST",x=>{x.departmentId=id(99);},"PARENT_IDENTITY_MISMATCH");
  reject("TEST",x=>{x.methodId=id(99);},"PARENT_IDENTITY_MISMATCH");
  reject("COMPONENT",x=>{x.testId=id(99);},"PARENT_IDENTITY_MISMATCH");
  reject("COMPONENT",x=>{x.unit={code:"U",symbol:"mmol/L"};},"PARENT_IDENTITY_MISMATCH");
  reject("UNIT",x=>{x.ucumCode="mmol/L";},"PARENT_IDENTITY_MISMATCH");
  reject("REFERENCE_INTERVAL",x=>{x.branchId=id(99);},"BRANCH_OR_TARIFF_SCOPE_MISMATCH");
  reject("REFERENCE_INTERVAL",x=>{x.analyzerId=id(99);},"PARENT_IDENTITY_MISMATCH");
  reject("PRICE_LIST",x=>{x.currency="USD";},"BRANCH_OR_TARIFF_SCOPE_MISMATCH");
  reject("PRICE_LIST",x=>{x.branchId=id(99);},"BRANCH_OR_TARIFF_SCOPE_MISMATCH");
  reject("PRICE_LIST",x=>{x.clientId=id(99);},"BRANCH_OR_TARIFF_SCOPE_MISMATCH");
  reject("PRICE_LIST_ITEM",x=>{x.priceListId=id(99);},"PARENT_IDENTITY_MISMATCH");
  reject("PRICE_LIST_ITEM",x=>{(x.priceList as Record<string,unknown>).currency="USD";},
    "BRANCH_OR_TARIFF_SCOPE_MISMATCH");
  reject("PRICE_LIST_PACKAGE_ITEM",x=>{x.packageId=id(99);},"PARENT_IDENTITY_MISMATCH");
  reject("PRICE_LIST_PACKAGE_ITEM",x=>{(x.priceList as Record<string,unknown>).contractId=id(99);},
    "BRANCH_OR_TARIFF_SCOPE_MISMATCH");
});
test("F2: whole composite membership rejects duplicate, missing, reordered or changed linked tests",()=>{
  for(const type of ["PANEL","PACKAGE"] as const){
    reject(type,x=>{x.items=[];},"COMPOSITE_MEMBERSHIP_MISMATCH");
    reject(type,x=>{x.items=[member,member];},"COMPOSITE_MEMBERSHIP_MISMATCH");
    reject(type,x=>{x.items=[{...member,testId:id(99)}];},"COMPOSITE_MEMBERSHIP_MISMATCH");
    reject(type,x=>{x.items=[{...member,displayOrder:2}];},"COMPOSITE_MEMBERSHIP_MISMATCH");
    reject(type,x=>{x.items=[{...member,test:{code:"WRONG"}}];},"COMPOSITE_MEMBERSHIP_MISMATCH");
  }
  reject("PANEL",x=>{x.items=[{...member,required:false}];},"COMPOSITE_MEMBERSHIP_MISMATCH");
  assert.equal(observe("PANEL",source("PANEL"),{
    ...source("PANEL"),items:[{...member,required:true},{...member,required:true}],
  }).status,"MAPPING_REQUIRED");
});
test("F2: unknown classes, null parents and forged identifiers fail closed and return no source values",()=>{
  for(const [kind,s,l] of [
    ["UNKNOWN",source("TEST"),source("TEST")],
    ["TEST",{id:"not-a-uuid",code:"TEST"},source("TEST")],
    ["COMPONENT",source("COMPONENT"),{...source("COMPONENT"),test:null}],
    ["PRICE_LIST_ITEM",source("PRICE_LIST_ITEM"),{...source("PRICE_LIST_ITEM"),priceList:null}],
  ] as const){
    const result=observeCatalogTargetIdentity(kind,s,l);
    assert.equal(result.status,"MAPPING_REQUIRED");
    assert.equal(result.sourceInstanceProven,false);
    assert.equal(result.mappingApproved,false);
    assert.equal(result.autoApplyAllowed,false);
    for(const sensitive of ["TEST","mg/dL","AED","45.6700","123.4500",id(1),id(5)]){
      assert.equal(JSON.stringify(result).includes(sensitive),false);
    }
  }
});
test("F2: drift GET and browser expose only bounded mapping reasons, never accept activation flags",()=>{
  const route=readFileSync("src/app/api/catalog/imports/[id]/bundle-drift/route.ts","utf8");
  const ui=readFileSync("src/components/catalog-bundle-drift-review.tsx","utf8");
  const commit=readFileSync("src/app/api/catalog/imports/[id]/commit/route.ts","utf8");
  assert.match(route,/observeCatalogTargetIdentity\(row\.entityType, row\.sourceData, currentJson\)/);
  assert.match(ui,/targetIdentity\.sourceInstanceProven !== false/);
  assert.match(ui,/targetIdentity\.mappingApproved !== false/);
  assert.match(ui,/targetIdentity\.autoApplyAllowed !== false/);
  assert.match(commit,/CONFIG_BUNDLE_REVIEW/);
  assert.match(commit,/CSV_REVIEW/);
});
