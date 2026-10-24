import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  lockActiveReferenceContext, ReferenceIntervalGateError,
} from "../src/lib/reference-interval-live-authority.ts";

const scope = {
  organizationId:"ORG",branchId:"BRANCH",
  methodId:"METHOD",analyzerId:"ANALYZER",specimenTypeId:"SPECIMEN",
};
type State = {
  methodActive?: boolean; specimenActive?: boolean; analyzerActive?: boolean;
  analyzerBranch?: string; analyzerOrganization?: string;
};
function scenario(state:State={}) {
  const queries:string[]=[];
  const tx={
    $queryRaw:async (parts:TemplateStringsArray,...params:unknown[])=>{
      const sql=parts.join("?");
      queries.push(sql);
      if(sql.includes("FROM methods"))return state.methodActive===false?[]:[{id:"METHOD"}];
      if(sql.includes("FROM specimen_types"))return state.specimenActive===false?[]:[{id:"SPECIMEN"}];
      if(sql.includes("FROM analyzers"))return state.analyzerActive===false?[]:
        [{id:"ANALYZER",branch_id:state.analyzerBranch??"BRANCH"}];
      throw Error("unexpected query: "+sql+params.length);
    },
  };
  return {tx:tx as unknown as Parameters<typeof lockActiveReferenceContext>[0],queries};
}
async function denied(value:Promise<unknown>,errorCode:string) {
  await assert.rejects(value,(error:unknown)=>error instanceof ReferenceIntervalGateError &&
    error.errorCode===errorCode && error.status>=400);
}

test("F8 §75/87: clinical context is live scoped and locked at APPROVE, never trusted from DRAFT",async()=>{
  const s=scenario();
  await lockActiveReferenceContext(s.tx,scope);
  assert.equal(s.queries.length,3);
  for(const query of s.queries) {
    assert.match(query,/FOR UPDATE/);
    assert.match(query,/organization_id=/);
    assert.match(query,/status='ACTIVE'/);
  }
  for(const [state,code] of [
    [{methodActive:false},"method_not_found"],
    [{specimenActive:false},"specimen_type_not_found"],
    [{analyzerActive:false},"analyzer_not_found"],
    [{analyzerBranch:"OTHER_BRANCH"},"analyzer_branch_mismatch"],
  ] as const) await denied(lockActiveReferenceContext(scenario(state).tx,scope),code);
});

test("F8 §75/87: organization-level interval cannot claim branch-specific analyzer authority",async()=>{
  const x=scenario();
  await denied(lockActiveReferenceContext(x.tx,{...scope,branchId:null}),
    "analyzer_branch_scope_required");
  assert.ok(x.queries.some(query=>query.includes("FROM methods")));
  assert.ok(x.queries.some(query=>query.includes("FROM specimen_types")));
  assert.ok(!x.queries.some(query=>query.includes("FROM analyzers")),
    "global analyzer ambiguity must be rejected even before trusting analyzer data");
  const global=scenario();
  await lockActiveReferenceContext(global.tx,{...scope,branchId:null,analyzerId:null});
  assert.equal(global.queries.length,2);
});

test("F8 §75/87: both draft and approval run context check inside same protected write transaction",()=>{
  const route=readFileSync("src/app/api/catalog/reference-intervals/route.ts","utf8");
  const post=route.slice(0,route.indexOf("export async function PATCH("));
  const patch=route.slice(route.indexOf("export async function PATCH("));
  assert.ok(post.includes('error: "analyzer_branch_scope_required"'));
  const first=post.indexOf("lockActiveReferenceContext(tx");
  assert.ok(first>post.indexOf("lockReferenceIntervalWriteAuthority(tx"));
  assert.ok(first<post.indexOf("tx.referenceInterval.create({"));
  const second=patch.indexOf("lockActiveReferenceContext(tx");
  assert.ok(second>patch.indexOf("lockReferenceIntervalWriteAuthority(tx"));
  assert.ok(second>patch.indexOf("lockActiveReferenceComponent(tx"));
  assert.ok(second<patch.indexOf("tx.referenceInterval.findMany({"));
  assert.ok(second<patch.indexOf('data:{approvalStatus:"APPROVED"'));
  for(const required of [
    "methodId:interval.methodId","analyzerId:interval.analyzerId",
    "specimenTypeId:interval.specimenTypeId","branchId:interval.branchId",
    "planReferenceIntervalApproval(interval,approved)",
    "tx.auditEvent.create",
  ])assert.ok(patch.includes(required),required);
});
