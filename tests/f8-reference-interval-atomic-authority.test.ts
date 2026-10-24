import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {
  lockReferenceIntervalWriteAuthority, lockActiveReferenceComponent,
  lockActiveReferenceContext, ReferenceIntervalGateError,
} from "../src/lib/reference-interval-live-authority.ts";

const A="A",B="B",ORG="O",USER="U";
type FakeOptions={branches?:string[];currentGrants?:string[];
  sessionGrants?:string[];role?:boolean;active?:boolean;
  component?:boolean;method?:boolean;analyzer?:boolean;
  specimen?:boolean;analyzerBranch?:string};
function fixture(o:FakeOptions={}) {
  const requests:string[]=[];
  const tx={
    $queryRaw:async (strings:TemplateStringsArray,...params:unknown[])=>{
      const sql=strings.join("?"); requests.push(sql);
      if(sql.includes("FROM organizations"))return o.active===false?[]:[{id:ORG}];
      if(sql.includes("FROM users u"))return o.role===false?[]:[{id:USER}];
      if(sql.includes("FROM user_branch_scopes s"))return (o.currentGrants||[A,B])
        .map(branchId=>({branchId}));
      if(sql.includes("FROM branches"))return (o.branches||[A,B]).map(id=>({id}));
      if(sql.includes("FROM test_components"))return o.component===false?[]:[{id:"C"}];
      if(sql.includes("FROM methods"))return o.method===false?[]:[{id:"M"}];
      if(sql.includes("FROM specimen_types"))return o.specimen===false?[]:[{id:"S"}];
      if(sql.includes("FROM analyzers"))return o.analyzer===false?[]:[{
        id:"X",branch_id:o.analyzerBranch||A,
      }];
      throw Error("Unexpected query "+sql+":"+params.length);
    },
    user:{findFirst:async()=>o.role===false?null:{id:USER}},
    userBranchScope:{findMany:async()=>(o.currentGrants||[A,B])
      .map(branchId=>({branchId}))},
  };
  return {tx:tx as unknown as Parameters<typeof lockReferenceIntervalWriteAuthority>[0],
    requests};
}
function input(branchId:string|null,sessionGrants:string[]=[A,B]) {
  return {organizationId:ORG,userId:USER,branchId,
    permission:"catalog.reference_ranges.approve" as const,
    sessionBranchIds:sessionGrants};
}
async function denied(p:Promise<unknown>,code:string){
  await assert.rejects(p,(e:unknown)=>e instanceof ReferenceIntervalGateError &&
    e.errorCode===code,code);
}

test("F8 clinical: organization lock and fresh grants precede any reference interval mutation",async()=>{
  const {tx,requests}=fixture();
  await lockReferenceIntervalWriteAuthority(tx,input(null));
  assert.match(requests[0],/organizations[\s\S]*FOR UPDATE/);
  assert.match(requests[1],/user_roles[\s\S]*role_permissions[\s\S]*FOR UPDATE/);
  assert.match(requests[2],/branches[\s\S]*FOR UPDATE/);
  assert.match(requests[3],/user_branch_scopes[\s\S]*FOR UPDATE/);
  assert.ok(requests[0].indexOf("organizations")>=0);
});

test("F8 clinical: org-wide clinical authority requires all ACTIVE branches in live DB and session",async()=>{
  await denied(lockReferenceIntervalWriteAuthority(
    fixture({currentGrants:[A]}).tx,input(null)),
    "organization_scope_incomplete");
  await denied(lockReferenceIntervalWriteAuthority(
    fixture().tx,input(null,[A])),"organization_scope_incomplete");
  await denied(lockReferenceIntervalWriteAuthority(
    fixture({branches:[]}).tx,input(null)),"organization_scope_incomplete");
  await denied(lockReferenceIntervalWriteAuthority(
    fixture({branches:[A,B]}).tx,input(B,[A])),"branch_forbidden");
  await denied(lockReferenceIntervalWriteAuthority(
    fixture({currentGrants:[A]}).tx,input(B)),"branch_forbidden");
  await denied(lockReferenceIntervalWriteAuthority(
    fixture({branches:[A]}).tx,input(B)),"branch_not_found");
  // An inactive branch no longer demands organization-wide coverage.
  await lockReferenceIntervalWriteAuthority(
    fixture({branches:[A],currentGrants:[A]}).tx,input(null,[A]));
});

test("F8 clinical: current actor permission and active tenant are re-checked, not inherited from session",async()=>{
  await denied(lockReferenceIntervalWriteAuthority(
    fixture({role:false}).tx,input(A)),"forbidden");
  await denied(lockReferenceIntervalWriteAuthority(
    fixture({active:false}).tx,input(A)),"forbidden");
});

test("F8 clinical: DRAFT parent component and optional vendor context fail closed on deactivation",async()=>{
  const {tx,requests}=fixture();
  await lockActiveReferenceComponent(tx,ORG,"C");
  await lockActiveReferenceContext(tx,{organizationId:ORG,branchId:A,
    methodId:"M",analyzerId:"X",specimenTypeId:"S"});
  for(const raw of requests)assert.match(raw,/FOR UPDATE/);
  await denied(lockActiveReferenceComponent(
    fixture({component:false}).tx,ORG,"C"),"component_not_found");
  for(const [choice,code] of [
    [{method:false},"method_not_found"],
    [{analyzer:false},"analyzer_not_found"],
    [{specimen:false},"specimen_type_not_found"],
    [{analyzerBranch:B},"analyzer_branch_mismatch"],
  ] as const){
    const altered=fixture(choice);
    await denied(lockActiveReferenceContext(altered.tx,{
      organizationId:ORG,branchId:A,
      methodId:"M",analyzerId:"X",specimenTypeId:"S",
    }),code);
  }
});

test("F8 clinical: both POST and PATCH use same transaction authority; approval candidates re-read after lock",()=>{
  const route=readFileSync("src/app/api/catalog/reference-intervals/route.ts","utf8");
  const patch=route.slice(route.indexOf("export async function PATCH("));
  const post=route.slice(0,route.indexOf("export async function PATCH("));
  assert.ok((route.match(/lockReferenceIntervalWriteAuthority\(tx/g)||[]).length===2);
  assert.ok(post.indexOf("lockReferenceIntervalWriteAuthority(tx")<
    post.indexOf("tx.referenceInterval.create({"));
  assert.ok(post.includes("lockActiveReferenceComponent(tx"));
  assert.ok(post.includes("lockActiveReferenceContext(tx"));
  assert.ok(patch.indexOf("lockReferenceIntervalWriteAuthority(tx")<
    patch.indexOf("tx.referenceInterval.findMany({"));
  assert.ok(patch.indexOf("tx.referenceInterval.findMany({")<
    patch.indexOf("planReferenceIntervalApproval(interval,approved)"));
  assert.ok(patch.includes("reference_intervals WHERE id="));
  assert.ok(patch.includes("FOR UPDATE"));
  assert.ok(patch.includes('where:{id:interval.id,approvalStatus:"DRAFT",status:"INACTIVE"}'));
  assert.ok(patch.includes('where:{id:interval.id,approvalStatus:"APPROVED",status:"ACTIVE"'));
  assert.ok(patch.includes("approvedUpdate.count!==1"));
  assert.ok(patch.includes("retiredUpdate.count!==1"));
  assert.ok(patch.includes("changed.count!==1"));
  assert.ok(patch.includes("ReferenceIntervalGateError"));
  assert.ok(patch.includes("tx.auditEvent.create"));
  assert.ok(!patch.includes("await prisma.referenceInterval.findMany("));
  assert.ok(!patch.includes("await prisma.referenceInterval.update("));
});
