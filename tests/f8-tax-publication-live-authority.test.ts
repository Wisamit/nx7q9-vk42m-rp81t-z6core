import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  lockTaxPublicationAuthority,
  TaxPublicationGateError,
} from "../src/lib/tax-publication-live-authority.ts";

const org="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const actor="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const branchA="cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const branchB="dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const service="eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

type Options={
  orgLive?:boolean;roleLive?:boolean;branches?:string[];liveGrants?:string[];
  sessionGrants?:string[];serviceLive?:boolean;branchId?:string|null;
  serviceType?:"TEST"|"PACKAGE";
};
function scenario({
  orgLive=true,roleLive=true,branches=[branchA],liveGrants=[branchA],
  sessionGrants=[branchA],serviceLive=true,branchId=branchA,serviceType="TEST",
}:Options={}){
  const queried:string[]=[];
  const tx={
    $queryRaw:async (raw:TemplateStringsArray,...values:unknown[])=>{
      const statement=raw.join("?");
      queried.push(statement);
      if(statement.includes("FROM organizations"))return orgLive?[{id:org}]:[];
      if(statement.includes("FROM branches"))return branches.map(id=>({id}));
      if(statement.includes("FROM lab_tests")||
         statement.includes("FROM commercial_packages"))
        return serviceLive?[{id:service}]:[];
      throw Error("unexpected tax lock SQL");
    },
    user:{
      findFirst:async (arg:unknown)=>{
        assert.ok(JSON.stringify(arg).includes("billing.tax.manage"));
        assert.ok(JSON.stringify(arg).includes('"status":"ACTIVE"'));
        return roleLive?{id:actor}:null;
      },
    },
    userBranchScope:{
      findMany:async (arg:unknown)=>{
        assert.ok(JSON.stringify(arg).includes('"status":"ACTIVE"'));
        return liveGrants.map(branchId=>({branchId}));
      },
    },
  };
  return {
    queried,
    evaluate:()=>lockTaxPublicationAuthority(tx as never,{
      organizationId:org,userId:actor,branchId,serviceId:service,
      serviceType,sessionBranchIds:sessionGrants,
    }),
  };
}

test("F8 §86: active scoped branch and live test require locked tenant and service",async()=>{
  const x=scenario();
  assert.deepEqual(await x.evaluate(),{ok:true,affectedBranches:1});
  assert.equal(x.queried.length,3);
  assert.ok(x.queried[0].includes("FOR UPDATE"));
  assert.ok(x.queried[1].includes("FOR UPDATE"));
  assert.ok(x.queried[2].includes("FOR UPDATE"));
});

test("F8 §86: stale role or disabled tenant cannot publish tax revisions",async()=>{
  assert.deepEqual(await scenario({orgLive:false}).evaluate(),
    {ok:false,error:"tax_authority_forbidden",status:403});
  assert.deepEqual(await scenario({roleLive:false}).evaluate(),
    {ok:false,error:"tax_authority_forbidden",status:403});
});

test("F8 §86: stale/inactive or unauthorized branch fails closed",async()=>{
  assert.deepEqual(await scenario({branches:[]}).evaluate(),
    {ok:false,error:"branch_not_found",status:404});
  assert.deepEqual(await scenario({liveGrants:[]}).evaluate(),
    {ok:false,error:"branch_forbidden",status:403});
  assert.deepEqual(await scenario({sessionGrants:[]}).evaluate(),
    {ok:false,error:"branch_forbidden",status:403});
});

test("F8 §86: tenant-wide policy must cover every ACTIVE branch in BOTH live and session grants",async()=>{
  const allowed=scenario({branchId:null,branches:[branchA,branchB],
    liveGrants:[branchA,branchB],sessionGrants:[branchA,branchB]});
  assert.deepEqual(await allowed.evaluate(),{ok:true,affectedBranches:2});
  assert.deepEqual(await scenario({branchId:null,branches:[branchA,branchB],
    liveGrants:[branchA],sessionGrants:[branchA,branchB]}).evaluate(),
    {ok:false,error:"organization_scope_incomplete",status:403});
  assert.deepEqual(await scenario({branchId:null,branches:[branchA,branchB],
    liveGrants:[branchA,branchB],sessionGrants:[branchA]}).evaluate(),
    {ok:false,error:"organization_scope_incomplete",status:403});
  assert.deepEqual(await scenario({branchId:null,branches:[]}).evaluate(),
    {ok:false,error:"organization_scope_incomplete",status:403});
});

test("F8 §86: test or package deactivation between request and insertion is rejected",async()=>{
  for(const serviceType of ["TEST","PACKAGE"] as const){
    const x=scenario({serviceType,serviceLive:false});
    assert.deepEqual(await x.evaluate(),
      {ok:false,error:"tax_service_not_found",status:404});
    assert.ok(x.queried[2].includes(serviceType==="TEST"?"FROM lab_tests":"FROM commercial_packages"));
  }
});

test("F8 §86: tax-rule write and audit occur only after transactional reauthorization",()=>{
  const route=readFileSync("src/app/api/billing/tax-rules/route.ts","utf8");
  const guard=readFileSync("src/lib/tax-publication-live-authority.ts","utf8");
  assert.ok(route.includes("lockTaxPublicationAuthority(tx"));
  assert.ok(route.indexOf("lockTaxPublicationAuthority(tx")<
    route.indexOf("tx.branch.updateMany({"));
  assert.ok(route.indexOf("tx.branch.updateMany({")<
    route.indexOf("tx.taxRule.create({"));
  assert.ok(route.indexOf("tx.taxRule.create({")<
    route.indexOf("tx.auditEvent.create({"));
  assert.ok(route.includes("revision.count !== authority.affectedBranches"));
  assert.ok(route.includes("TaxPublicationGateError"));
  assert.ok(guard.includes("billing.tax.manage"));
  assert.ok(guard.includes('status:"ACTIVE"'));
  assert.ok(guard.includes("FOR UPDATE"));
  assert.ok(route.includes('taxConfigVersion: { increment: 1 }'));
  assert.ok(route.includes('action: "TAX_RULE_PUBLISHED"'));
  assert.equal(route.includes("prisma.branch.findMany({"),false);
  assert.equal(route.includes("prisma.labTest.findFirst({"),false);
  assert.ok(route.includes("parseExactTaxPublicationInput(body)"));
});

test("F8 §86: typed gate errors retain audit-neutral status and code",()=>{
  const error=new TaxPublicationGateError("tax_branch_state_changed",409);
  assert.equal(error.status,409);
  assert.equal(error.errorCode,"tax_branch_state_changed");
});
