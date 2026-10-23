import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseExactTaxPublicationInput } from "../src/lib/tax-publication-input.ts";
import { taxLineAmounts } from "../src/lib/tax-policy.ts";

const id="aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const branch="01234567-89ab-4cde-8fff-0123456789ab";
const allowed=()=>({
  branchId:branch,serviceType:"TEST",serviceId:id,
  code:"TAX_CONFIRMED",nameEn:"Explicit policy",nameAr:"قاعدة ضريبية معتمدة",
  treatment:"STANDARD",priceMode:"EXCLUSIVE",ratePercent:"5.00",
  effectiveFrom:"2026-10-23",reason:"Owner/accountant supplied this documented revision",
});
const deny=(raw:unknown,label:string)=>{
  assert.deepEqual(parseExactTaxPublicationInput(raw),
    {ok:false,error:"invalid_tax_fields"},label);
};

test("F8 §86: admit explicit exact day, tenant-scoped UUIDs and bilingual reviewed tax policy",()=>{
  const result=parseExactTaxPublicationInput(allowed());
  assert.equal(result.ok,true);
  if(!result.ok)throw Error("expected accepted tax publication");
  assert.equal(result.value.branchId,branch);
  assert.equal(result.value.serviceId,id);
  assert.equal(result.value.nameAr,"قاعدة ضريبية معتمدة");
  assert.equal(result.value.ratePercent,"5.00");
  assert.equal(result.value.effectiveFrom,"2026-10-23");
  const org= parseExactTaxPublicationInput({...allowed(),branchId:""});
  assert.equal(org.ok,true);
  if(org.ok)assert.equal(org.value.branchId,null);
  const pkg=parseExactTaxPublicationInput({...allowed(),serviceType:"PACKAGE"});
  assert.equal(pkg.ok,true);
});

test("F8 §86: malformed / overlong UUIDs must never be silently truncated into another branch or service",()=>{
  deny({...allowed(),branchId:branch+"extra"},"branch identity suffix");
  deny({...allowed(),serviceId:id+"extra"},"service identity suffix");
  deny({...allowed(),branchId:"x".repeat(37)},"overlong branch");
  deny({...allowed(),serviceId:"x".repeat(37)},"overlong service");
  deny({...allowed(),branchId:"  "+branch},"padded branch scope");
  deny({...allowed(),branchId:"not-a-uuid"},"malformed branch");
});

test("F8 §86: effective local calendar day cannot be quietly truncated or rolled over",()=>{
  for(const day of [
    "2026-10-23T12:30:00Z","2026-10-23junk","2026-10-23 ",
    "2026-02-30","2025-02-29","2026-13-01","2026-00-12",
    "2026-01-00","2026-01-40","23/10/2026","2026-1-3",
    20261023,null,undefined,
  ])deny({...allowed(),effectiveFrom:day},String(day));
  const leap=parseExactTaxPublicationInput({...allowed(),effectiveFrom:"2028-02-29"});
  assert.equal(leap.ok,true);
});

test("F8 §86: names, Arabic and reason never silently truncate to fit stored financial schema",()=>{
  const checks:[string,unknown][]=[
    ["nameEn","E".repeat(201)],["nameAr","ع".repeat(201)],
    ["reason","R".repeat(1001)],["code","X".repeat(61)],
    ["code","a"],["nameEn"," "],["reason"," "],
    ["nameEn",45],["nameAr",{}],["reason",[]],
  ];
  for(const [key,value] of checks)
    deny({...allowed(),[key]:value},key);
  const edge=parseExactTaxPublicationInput({...allowed(),
    nameEn:"N".repeat(200),nameAr:"ع".repeat(200),reason:"R".repeat(1000)});
  assert.equal(edge.ok,true);
  if(edge.ok){
    assert.equal(edge.value.nameEn.length,200);
    assert.equal(edge.value.nameAr.length,200);
    assert.equal(edge.value.reason.length,1000);
  }
});

test("F8 §86: tax rate requires exact DECIMAL string, explicit mode and treatment; no guessed policy",()=>{
  for(const value of [5,5.12,0.1,Number.MAX_SAFE_INTEGER,null,
    "5.001","101.00","-5.00","NaN","Infinity","1e1","5,50"]){
    deny({...allowed(),ratePercent:value},"untrusted rate "+String(value));
  }
  for(const [key,value] of [
    ["treatment","UNKNOWN"],["priceMode","DEFAULT"],["serviceType","ANALYZER"],
  ])deny({...allowed(),[key]:value},key);
  for(const payload of [null,[],{},true,1,"string"]){
    deny(payload,"invalid body");
  }
  const good=parseExactTaxPublicationInput(allowed());
  assert.equal(good.ok,true);
  if(good.ok)
    assert.deepEqual(taxLineAmounts({netAfterDiscount:"100.0000",rule:good.value}),{
      taxableBase:"100.0000",taxAmount:"5.0000",exclusiveTax:"5.0000",
      lineTotal:"105.0000",
    });
  // An omitted or unqualified accountant policy is never fabricated here.
  deny({...allowed(),ratePercent:undefined},"missing rate");
});

test("F8 §86: server route consumes exact structured input and retains audited scope-bound versioning",()=>{
  const route=readFileSync("src/app/api/billing/tax-rules/route.ts","utf8");
  const guard=readFileSync("src/lib/tax-publication-input.ts","utf8");
  assert.ok(route.includes("parseExactTaxPublicationInput(body)"));
  assert.ok(route.includes("if (!admission.ok)"));
  assert.equal(/\.slice\(0,\s*max\)/.test(route),false);
  assert.ok(route.includes('permissionSet(session).has("billing.tax.manage")'));
  assert.ok(route.includes("canAccessBranch(session, branchId)"));
  assert.ok(route.includes('status: "ACTIVE"'));
  assert.ok(route.includes("taxConfigVersion: { increment: 1 }"));
  assert.ok(route.includes('action: "TAX_RULE_PUBLISHED"'));
  assert.ok(route.includes("tx.taxRule.create"));
  assert.ok(guard.includes("nextDateString(effectiveFrom)"));
  assert.ok(guard.includes('typeof raw.ratePercent==="string"'));
});
