import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  lockLiveTaxPublicationAuthority,TaxPublicationAuthorityError,
} from "../src/lib/tax-publication-authority.ts";

const organizationId="aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const userId="bbbbbbbb-aaaa-4ccc-8ddd-eeeeeeeeeeee";
const branchA="cccccccc-aaaa-4ccc-8ddd-eeeeeeeeeeee";
const branchB="dddddddd-aaaa-4ccc-8ddd-eeeeeeeeeeee";
const serviceId="eeeeeeee-aaaa-4ccc-8ddd-eeeeeeeeeeee";
const input=(branchId:string|null=branchA)=>({
  userId,organizationId,branchId,serviceId,serviceType:"TEST" as "TEST" | "PACKAGE",
  sessionBranchIds:[branchA,branchB],
});
function fake(opts:{
  tenant?:boolean;role?:boolean;activeBranches?:string[];
  liveScopes?:string[];affected?:number;service?:boolean;
}={}){
  const calls:string[]=[];
  const activeBranches=opts.activeBranches??[branchA,branchB];
  const grants=opts.liveScopes??[branchA,branchB];
  const tx={
    $queryRaw:async(strings:TemplateStringsArray,...args:unknown[])=>{
      const query=strings.join("?");calls.push(query);
      if(query.includes("FROM organizations"))return opts.tenant===false?[]:[{id:organizationId}];
      if(query.includes("FROM lab_tests")||query.includes("FROM commercial_packages"))
        return opts.service===false?[]:[{id:serviceId}];
      throw Error("unexpected database query");
    },
    user:{findFirst:async()=>{calls.push("user.live.actor");return opts.role===false?null:{id:userId};}},
    branch:{
      findMany:async()=>{calls.push("branches.active");return activeBranches.map(id=>({id}));},
      updateMany:async(input:{where:{id?:string}})=>{
        calls.push("branches.taxConfigVersion.increment");
        return {count:opts.affected??(input.where.id?1:activeBranches.length)};
      },
    },
    userBranchScope:{findMany:async()=>{calls.push("scope.live");return grants.map(branchId=>({branchId}));}},
  };
  return {tx,calls};
}
async function expectDenied(opts:Parameters<typeof fake>[0],data:ReturnType<typeof input>,
  code:string,status:number){
  const f=fake(opts);
  await assert.rejects(()=>lockLiveTaxPublicationAuthority(f.tx as never,data),
    (e:unknown)=>e instanceof TaxPublicationAuthorityError &&
      e.code===code && e.status===status,code);
  return f.calls;
}

test("F8 §86: lock active organization, check live tax grant and scope, bump version, lock service",async()=>{
  const f=fake();
  await lockLiveTaxPublicationAuthority(f.tx as never,input());
  assert.match(f.calls[0],/organizations[\s\S]*FOR UPDATE/);
  assert.deepEqual(f.calls.slice(1,5),[
    "user.live.actor","branches.active","scope.live",
    "branches.taxConfigVersion.increment"]);
  assert.match(f.calls[5],/lab_tests[\s\S]*FOR UPDATE/);
  const org=fake();
  await lockLiveTaxPublicationAuthority(org.tx as never,input(null));
  assert.equal(org.calls.filter(x=>x==="branches.taxConfigVersion.increment").length,1);
  const pkg=fake();
  await lockLiveTaxPublicationAuthority(pkg.tx as never,
    {...input(),serviceType:"PACKAGE"});
  assert.match(pkg.calls.at(-1)||"",/commercial_packages[\s\S]*FOR UPDATE/);
});

test("F8 §86: revoked tax role or inactive tenant is denied before version and audit",async()=>{
  for(const opts of [{tenant:false},{role:false}]){
    const calls=await expectDenied(opts,input(),"tax_authority_forbidden",403);
    assert.ok(!calls.some(x=>x.includes("taxConfigVersion")));
  }
});

test("F8 §86: revoked branch grant and stale session cannot publish",async()=>{
  const calls=await expectDenied({liveScopes:[branchB]},input(),
    "branch_forbidden",403);
  assert.ok(!calls.some(x=>x.includes("taxConfigVersion")));
  const noSession=await expectDenied({},{
    ...input(),sessionBranchIds:[branchB]},"branch_forbidden",403);
  assert.ok(!noSession.some(x=>x.includes("taxConfigVersion")));
  await expectDenied({activeBranches:[branchB]},input(),"branch_not_found",404);
});

test("F8 §86: organization tax rules require all current active branch grants",async()=>{
  const calls=await expectDenied({liveScopes:[branchA]},input(null),
    "organization_scope_incomplete",403);
  assert.ok(!calls.some(x=>x.includes("taxConfigVersion")));
  await expectDenied({activeBranches:[]},input(null),
    "organization_scope_incomplete",403);
});

test("F8 §86: branch update count drift is a conflict, not successful tax posting",async()=>{
  const calls=await expectDenied({affected:0},input(),"tax_branch_configuration_changed",409);
  assert.ok(!calls.some(x=>x.includes("lab_tests")));
  const org=await expectDenied({affected:1},input(null),
    "tax_branch_configuration_changed",409);
  assert.ok(!org.some(x=>x.includes("lab_tests")));
});

test("F8 §86: retired or foreign test and package cannot authorize a new revision",async()=>{
  const testCalls=await expectDenied({service:false},input(),
    "tax_service_not_found",404);
  assert.ok(testCalls.some(x=>x.includes("FOR UPDATE")));
  await expectDenied({service:false},{...input(),serviceType:"PACKAGE"},
    "tax_service_not_found",404);
});

test("F8 §86: real API uses guarded transaction for rule and audit; no external tax assumptions",()=>{
  const route=readFileSync("src/app/api/billing/tax-rules/route.ts","utf8");
  const auth=readFileSync("src/lib/tax-publication-authority.ts","utf8");
  const schema=readFileSync("prisma/schema.prisma","utf8");
  assert.match(route,/prisma\.\$transaction\(async tx => \{/);
  assert.match(route,/await lockLiveTaxPublicationAuthority\(tx/);
  assert.ok(route.indexOf("await lockLiveTaxPublicationAuthority(tx") <
    route.indexOf("tx.taxRule.create"));
  assert.ok(route.indexOf("await lockLiveTaxPublicationAuthority(tx") <
    route.indexOf("tx.auditEvent.create"));
  assert.ok(route.includes("error instanceof TaxPublicationAuthorityError"));
  assert.ok(route.includes('permissionSet(session).has("billing.tax.manage")'));
  assert.ok(auth.includes('code:"billing.tax.manage"'));
  assert.ok(auth.includes('AND status = \'ACTIVE\' FOR UPDATE'));
  assert.ok(auth.includes("taxConfigVersion:{increment:1}"));
  assert.ok(schema.includes("@@unique([organizationId, scopeKey, effectiveFrom])"));
});
