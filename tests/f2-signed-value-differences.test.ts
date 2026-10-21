import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {
  sameLiveReferenceIntervalMedicalSnapshot,sameLiveTariffReviewIdentity,
} from "../src/lib/catalog-policy-review-scope.ts";

const base={
  methodId:null,analyzerId:null,specimenTypeId:null,sex:"ANY",
  ageUnit:null,pregnancyStatus:null,populationCode:null,
  normalTextEn:"Within expected range",normalTextAr:null,
  source:"Synthetic clinical range",notes:"pre-revision",
  ageFrom:null,ageTo:null,gestationalAgeFromWeeks:null,
  gestationalAgeToWeeks:null,lowValue:"1.000000",highValue:"5.000000",
  criticalLow:"0.500000",criticalHigh:"6.000000",
  effectiveTo:null,approvedAt:null,retiredAt:null,
};
test("F2: signed clinical revisions may change values but not population or lifecycle identity",()=>{
  const desired={...base,criticalLow:"0.200000",
    normalTextEn:"Revised explanation",notes:"approved adjustment"};
  assert.equal(sameLiveReferenceIntervalMedicalSnapshot(desired,base),false,
    "old reviewer evidence remains strict by default");
  assert.equal(sameLiveReferenceIntervalMedicalSnapshot(desired,base,true),true);
  assert.equal(sameLiveReferenceIntervalMedicalSnapshot(
    {...desired,sex:"FEMALE"},base,true),false);
  assert.equal(sameLiveReferenceIntervalMedicalSnapshot(
    {...desired,ageFrom:"18.000"},base,true),false);
  assert.equal(sameLiveReferenceIntervalMedicalSnapshot(
    {...desired,gestationalAgeFromWeeks:"2.00"},base,true),false);
  assert.equal(sameLiveReferenceIntervalMedicalSnapshot(
    {...desired,methodId:"00000000-0000-4000-8000-000000000099"},base,true),false);
  assert.equal(sameLiveReferenceIntervalMedicalSnapshot(
    {...desired,effectiveTo:"2026-12-01T00:00:00.000Z"},base,true),false);
  assert.equal(sameLiveReferenceIntervalMedicalSnapshot(
    {...desired,criticalLow:"not-a-decimal"},base,true),false);
  assert.equal(sameLiveReferenceIntervalMedicalSnapshot(
    {...desired,ageFrom:"invalid"},base,true),false);
  assert.equal(sameLiveReferenceIntervalMedicalSnapshot(
    {...desired,notes:"changed",populationCode:"OTHER"},base,true),false);
  assert.equal(sameLiveReferenceIntervalMedicalSnapshot(
    {...desired,criticalLow:null},base,true),true);
});
test("F2: signed exact tariff changes are allowed but never financial identity mutation",()=>{
  const id="00000000-0000-4000-8000-000000000001";
  const list="00000000-0000-4000-8000-000000000002";
  const testId="00000000-0000-4000-8000-000000000003";
  const now="2026-05-01T00:00:00.000Z";
  const n={id,priceListId:list,testId,testCode:"GLU",priceListCode:"BASE",
    scopeType:"ORGANIZATION",branchId:null,unitPrice:"92.1250",
    effectiveFrom:now,effectiveTo:null,status:"ACTIVE"};
  const parent={code:"BASE",currency:"USD",scopeType:"ORGANIZATION",
    branchId:null,status:"ACTIVE",sourceId:null,referrerId:null,clientId:null,contractId:null};
  const src={priceList:parent,effectiveTo:null};
  const live={id,priceListId:list,testId,test:{code:"GLU"},
    priceList:parent,unitPrice:"91.1250",
    effectiveFrom:new Date(now),effectiveTo:null,status:"ACTIVE"};
  assert.equal(sameLiveTariffReviewIdentity("PRICE_LIST_ITEM",n,src,live),false);
  assert.equal(sameLiveTariffReviewIdentity("PRICE_LIST_ITEM",n,src,live,true),true);
  assert.equal(sameLiveTariffReviewIdentity("PRICE_LIST_ITEM",
    {...n,priceListId:testId},src,live,true),false);
  assert.equal(sameLiveTariffReviewIdentity("PRICE_LIST_ITEM",
    {...n,unitPrice:"not-decimal"},src,live,true),false);
  assert.equal(sameLiveTariffReviewIdentity("PRICE_LIST_ITEM",
    {...n,effectiveFrom:"2025-05-01T00:00:00.000Z"},src,live,true),false);
  assert.equal(sameLiveTariffReviewIdentity("PRICE_LIST_ITEM",
    {...n,status:"INACTIVE"},src,live,true),false);
});
test("F2: only MFA source signing explicitly opts into planned value differences",()=>{
  const scope=readFileSync("src/lib/catalog-policy-review-scope.ts","utf8");
  const sign=readFileSync(
    "src/app/api/catalog/imports/[id]/configuration-approval/route.ts","utf8");
  const policy=readFileSync(
    "src/app/api/catalog/imports/[id]/policy-review/route.ts","utf8");
  assert.match(scope,/allowGovernedValueDifferences\?: true/);
  assert.match(scope,/input\.allowGovernedValueDifferences === true/);
  assert.match(sign,/allowGovernedValueDifferences:true/);
  assert.doesNotMatch(policy,/allowGovernedValueDifferences:true/);
});
