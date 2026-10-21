import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {
  sameLiveScalarIdentity,sameLiveClinicalReviewIdentity,
} from "../src/lib/catalog-policy-review-scope.ts";

const id=(n:number)=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const liveTest={
  id:id(1),code:"CBC",nameEn:"Historic label",
  departmentId:id(2),status:"ACTIVE",
};
const liveComponent={
  id:id(3),testId:id(1),unitId:id(4),code:"HB",
  nameEn:"Historic hemoglobin",status:"ACTIVE",test:{code:"CBC"},
};
const liveUnit={id:id(4),code:"MG_DL",symbol:"mg/dL",status:"ACTIVE"};
const liveContainer={id:id(5),code:"EDTA",nameEn:"Old tube",
  nameAr:null,tubeColor:"Purple",additive:"EDTA",status:"ACTIVE"};

test("F2: ordinary independent review remains strict; governed apply accepts only mutable clinical/catalog values",()=>{
  const changedTest={...liveTest,nameEn:"New label",status:"INACTIVE"};
  assert.equal(sameLiveScalarIdentity("TEST",changedTest,liveTest),false);
  assert.equal(sameLiveScalarIdentity("TEST",changedTest,liveTest,true),true);
  assert.equal(sameLiveScalarIdentity("TEST",{...changedTest,code:"OTHER"},liveTest,true),false);
  assert.equal(sameLiveScalarIdentity("TEST",{
    ...changedTest,departmentId:id(99),
  },liveTest,true),false);
  const changedUnit={...liveUnit,status:"INACTIVE"};
  assert.equal(sameLiveScalarIdentity("UNIT",changedUnit,liveUnit),false);
  assert.equal(sameLiveScalarIdentity("UNIT",changedUnit,liveUnit,true),true);
  assert.equal(sameLiveScalarIdentity("UNIT",{...changedUnit,symbol:"mmol/L"},liveUnit,true),false);
  const changedContainer={...liveContainer,nameEn:"New tube",
    tubeColor:"Lavender",status:"INACTIVE"};
  assert.equal(sameLiveScalarIdentity("CONTAINER",changedContainer,liveContainer),false);
  assert.equal(sameLiveScalarIdentity("CONTAINER",changedContainer,liveContainer,true),true);
  assert.equal(sameLiveScalarIdentity("CONTAINER",{...changedContainer,code:"NEW"},liveContainer,true),false);
  const stagedComponent={...liveComponent,nameEn:"New Hb",
    status:"INACTIVE",testCode:"CBC"};
  assert.equal(sameLiveClinicalReviewIdentity("COMPONENT",stagedComponent,liveComponent),false);
  assert.equal(sameLiveClinicalReviewIdentity("COMPONENT",stagedComponent,liveComponent,true),true);
  assert.equal(sameLiveClinicalReviewIdentity("COMPONENT",{
    ...stagedComponent,testId:id(91),
  },liveComponent,true),false);
  assert.equal(sameLiveClinicalReviewIdentity("COMPONENT",{
    ...stagedComponent,testCode:"INTRUDER",
  },liveComponent,true),false);
});
test("F2: desired composite changes are allowed only in governed branch, after signed stage and scoped live membership validation",()=>{
  const body=readFileSync("src/lib/catalog-policy-review-scope.ts","utf8");
  const entry=readFileSync("src/lib/catalog-f2-apply-entry.ts","utf8");
  const review=readFileSync("src/app/api/catalog/imports/[id]/policy-review/route.ts","utf8");
  assert.match(body,/if \(!live \|\| \(input\.allowGovernedValueDifferences !== true &&/);
  assert.match(body,/!sameLiveMembership\(row\.entityType, n\?\.items, live\)/);
  assert.match(body,/policyReviewIdentityScope\(rows,/);
  assert.match(body,/verifyReviewStageEvidence\(/);
  assert.match(body,/fullyVisibleMembership/);
  assert.match(entry,/allowGovernedValueDifferences:true/);
  assert.match(entry,/readF2EffectiveLiveObservations\(/);
  assert.doesNotMatch(review,/allowGovernedValueDifferences:true/,
    "ordinary reviewer comment path cannot opt out of full strict parity");
});
