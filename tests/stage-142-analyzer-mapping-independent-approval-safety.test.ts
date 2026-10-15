import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  analyzerMappingIndependentApprovalError, analyzerMappingReviewerIsLive,
} from "../src/lib/analyzer-mapping-governance.ts";

const time=new Date("2026-10-15T10:00:00.000Z");
const base={
  createdByUserId:"author",approvalStatus:"DRAFT",status:"INACTIVE",
  approvedByUserId:null,approvedAt:null,retiredAt:null,retiredByUserId:null,
};

test("Stage142: clinical analyzer mapping draft requires independent named author and clean immutable governance",()=>{
  assert.equal(analyzerMappingIndependentApprovalError(base,"reviewer"),null);
  assert.equal(analyzerMappingIndependentApprovalError(base,"author"),"analyzer_mapping_self_approval_forbidden");
  assert.equal(analyzerMappingIndependentApprovalError({...base,createdByUserId:null},"reviewer"),"analyzer_mapping_creator_unknown");
  for(const invalid of [
    {...base,approvalStatus:"APPROVED"},
    {...base,status:"ACTIVE"},
    {...base,approvedByUserId:"reviewer"},
    {...base,approvedAt:time},
    {...base,retiredAt:time},
    {...base,retiredByUserId:"author"},
  ]) assert.equal(analyzerMappingIndependentApprovalError(invalid,"reviewer"),"analyzer_mapping_not_draft");
});

test("Stage142: per-transaction reviewer checks live organization, active user, org-owned role and scoped branch",async()=>{
  const scope={organizationId:"ORG",branchId:"BR_A",userId:"reviewer",sessionBranchIds:["BR_A"]};
  let orgLive=true,userLive=true,roleActive=true,permission="analyzers.mappings.approve",branchLive=true,roleOrg="ORG";
  let calls:string[]=[];
  const tx={
    organization:{findFirst:async (args:unknown)=>{
      calls.push("org");
      assert.deepEqual(args,{where:{id:"ORG",status:"ACTIVE"},select:{id:true}});
      return orgLive?{id:"ORG"}:null;
    }},
    user:{findFirst:async (args:unknown)=>{
      calls.push("user");
      assert.equal((args as {where:{organizationId:string,status:string}}).where.organizationId,"ORG");
      assert.equal((args as {where:{status:string}}).where.status,"ACTIVE");
      return userLive?{roles:[{role:{status:roleActive?"ACTIVE":"INACTIVE",
        organizationId:roleOrg,permissions:[{permission:{code:permission}}]}}]}:null;
    }},
    userBranchScope:{findFirst:async (args:unknown)=>{
      calls.push("branch");
      const where=(args as {where:{branchId:string,userId:string,branch:{organizationId:string,status:string}}}).where;
      assert.equal(where.branchId,"BR_A");
      assert.equal(where.userId,"reviewer");
      assert.equal(where.branch.organizationId,"ORG");
      assert.equal(where.branch.status,"ACTIVE");
      return branchLive?{branchId:"BR_A"}:null;
    }},
  };
  const live=()=>analyzerMappingReviewerIsLive(tx as never,scope);
  assert.equal(await live(),true);
  assert.deepEqual(calls,["org","user","branch"]);
  calls=[];orgLive=false;assert.equal(await live(),false);assert.deepEqual(calls,["org"]);orgLive=true;
  calls=[];userLive=false;assert.equal(await live(),false);assert.deepEqual(calls,["org","user"]);userLive=true;
  calls=[];roleActive=false;assert.equal(await live(),false);roleActive=true;
  calls=[];roleOrg="FOREIGN";assert.equal(await live(),false);roleOrg="ORG";
  calls=[];permission="analyzers.manage";assert.equal(await live(),false);permission="analyzers.mappings.approve";
  calls=[];branchLive=false;assert.equal(await live(),false);branchLive=true;
  calls=[];assert.equal(await analyzerMappingReviewerIsLive(tx as never,{...scope,sessionBranchIds:["BR_B"]}),false);
  assert.deepEqual(calls,[],"session role cannot gain a new branch through a live check");
});

test("Stage142: route uses independent and persisted live checks AFTER serialization lock for approve and retire",()=>{
  const source=readFileSync("src/app/api/analyzers/[id]/mappings/route.ts","utf8");
  const patch=source.slice(source.indexOf("export async function PATCH"));
  assert.match(patch,/clinicalRuleGovernanceLock\.upsert/);
  const lock=patch.indexOf("clinicalRuleGovernanceLock.upsert");
  const fetch=patch.indexOf("const locked = await tx.analyzerTestMapping.findFirst");
  const live=patch.indexOf("await analyzerMappingReviewerIsLive(tx");
  const independent=patch.indexOf("analyzerMappingIndependentApprovalError(locked, session.user.id)");
  const firstWrite=patch.indexOf("await tx.analyzerTestMapping.update");
  assert.ok(lock>=0&&fetch>lock&&live>fetch&&independent>live&&firstWrite>independent,
    "live re-authorization and author separation must precede any approval/supersession write");
  assert.match(patch,/if \(!reviewerIsLive\) return \{ error: "analyzer_mapping_live_permission_revoked"/);
  assert.match(patch,/if \(approvalError\) return \{ error: approvalError \}/);
  assert.match(patch,/"analyzer_mapping_self_approval_forbidden"\]\.includes\(outcome.error\)/);
  assert.match(patch,/isolationLevel: "Serializable"/);
  assert.match(patch,/ANALYZER_TEST_MAPPING_APPROVED/);
  assert.match(patch,/ANALYZER_TEST_MAPPING_RETIRED/);

  const ui=readFileSync("src/components/analyzer-mapping-governance-button.tsx","utf8");
  const page=readFileSync("src/app/analyzers/page.tsx","utf8");
  assert.match(ui,/authorId !== actorId/);
  assert.match(ui,/canApprove && independent && approvalStatus === "DRAFT"/);
  assert.match(ui,/approvalStatus === "APPROVED"/);
  assert.match(ui,/analyzer_mapping_creator_unknown/);
  assert.match(ui,/analyzer_mapping_live_permission_revoked/);
  assert.match(page,/authorId=\{mapping.createdByUserId\} actorId=\{session.user.id\}/);
});
