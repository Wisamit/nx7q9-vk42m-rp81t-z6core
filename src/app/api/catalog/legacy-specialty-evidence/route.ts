import { NextResponse } from "next/server";
import { canAccessBranch, requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { clinicalImportTestWhere, resolveClinicalImportScope } from "@/lib/catalog-clinical-import-scope";
import {
  buildSelectedSpecialtyEvidenceReview, LEGACY_SPECIALTY_EVIDENCE_MAX_BYTES,
  LegacySpecialtyEvidenceError, parseSpecialtyEvidence,
} from "@/lib/legacy-specialty-evidence";

function fail(error:string,status:number){return NextResponse.json({error},{status,headers:{"Cache-Control":"no-store"}});}

/**
 * An ephemeral, read-only review endpoint. It neither stages legacy range values
 * nor creates/changes reference intervals, test components, or clinical history.
 * Upload bytes and observations are never persisted.
 */
export async function POST(request:Request){
  const session=await requirePermission("catalog.manage");
  if(!session.activeBranchId||!canAccessBranch(session,session.activeBranchId))
    return fail("active_branch_scope_required",403);
  const initialScope=resolveClinicalImportScope({
    organizationId:session.user.organizationId,activeBranchId:session.activeBranchId,
    activeBranch:session.activeBranch,branchScopes:session.user.branchScopes,
    departmentScopes:session.user.departmentScopes,
  });
  if(!initialScope)return fail("specialty_clinical_scope_required",403);
  const type=request.headers.get("content-type")||"";
  if(!/^application\/json(?:\s*;|$)/i.test(type))return fail("json_required",415);
  const length=Number(request.headers.get("content-length")||"0");
  if(!Number.isFinite(length)||length<0||length>LEGACY_SPECIALTY_EVIDENCE_MAX_BYTES)
    return fail("specialty_evidence_too_large",413);
  const rawText=await request.text();
  if(Buffer.byteLength(rawText,"utf8")>LEGACY_SPECIALTY_EVIDENCE_MAX_BYTES)
    return fail("specialty_evidence_too_large",413);
  let body:unknown;
  try{body=JSON.parse(rawText);}catch{return fail("invalid_json",400);}
  if(!body||typeof body!=="object"||Array.isArray(body))return fail("invalid_request",400);
  const data=body as Record<string,unknown>;
  const testId=typeof data.testId==="string"?data.testId:"";
  if(!/^[a-f0-9-]{36}$/i.test(testId))return fail("invalid_test_id",400);

  const selectedTable=typeof data.selectedTable==="string"?data.selectedTable:"";
  if(!selectedTable)return fail("selected_specialty_table_required",400);
  try{
    const evidence=parseSpecialtyEvidence(data.evidence);
    const outcome=await prisma.$transaction(async tx=>{
      // Re-check permissions, current branch and department grants at read time;
      // historical session access is not sufficient for exposing test metadata.
      const org=await tx.organization.findFirst({
        where:{id:session.user.organizationId,status:"ACTIVE"},select:{id:true},
      });
      if(!org)return {error:"specialty_organization_inactive",status:403} as const;
      const actor=await tx.user.findFirst({
        where:{id:session.user.id,organizationId:session.user.organizationId,status:"ACTIVE",
          roles:{some:{role:{organizationId:session.user.organizationId,status:"ACTIVE",
            permissions:{some:{permission:{code:"catalog.manage"}}}}}}},
        select:{id:true},
      });
      if(!actor)return {error:"specialty_permission_revoked",status:403} as const;
      const [liveBranch,liveBranches,liveDepartments]=await Promise.all([
        tx.branch.findFirst({where:{id:initialScope.branchId,
          organizationId:session.user.organizationId,status:"ACTIVE"},
          select:{id:true,organizationId:true,status:true}}),
        tx.userBranchScope.findMany({where:{userId:session.user.id,
          branch:{organizationId:session.user.organizationId,status:"ACTIVE"}},
          select:{branchId:true}}),
        tx.userDepartmentScope.findMany({where:{userId:session.user.id},
          select:{departmentId:true,department:{select:{
            status:true,organizationId:true,branchId:true,
          }}}}),
      ]);
      const originalBranches=new Set(session.user.branchScopes.map(x=>x.branchId));
      const originalDepartments=new Set(session.user.departmentScopes.map(x=>x.departmentId));
      const currentBranches=liveBranches.filter(x=>originalBranches.has(x.branchId));
      const currentDepartments=session.user.departmentScopes.length
        ? liveDepartments.filter(x=>originalDepartments.has(x.departmentId))
        : liveDepartments;
      if(session.user.departmentScopes.length&&!currentDepartments.length)
        return {error:"specialty_department_scope_revoked",status:403} as const;
      const liveScope=resolveClinicalImportScope({
        organizationId:session.user.organizationId,activeBranchId:initialScope.branchId,
        activeBranch:liveBranch,
        branchScopes:currentBranches.map(x=>({branchId:x.branchId,branch:{status:"ACTIVE"}})),
        departmentScopes:currentDepartments,
      });
      if(!liveScope)return {error:"specialty_branch_scope_revoked",status:403} as const;
      const test=await tx.labTest.findFirst({
        where:{...clinicalImportTestWhere(liveScope),id:testId},
        select:{id:true,code:true,components:{
          where:{status:"ACTIVE"},
          select:{id:true,code:true,nameEn:true,nameAr:true},
          orderBy:[{displayOrder:"asc"},{code:"asc"}],
        }},
      });
      if(!test)return {error:"active_test_not_in_clinical_scope",status:404} as const;
      const review=buildSelectedSpecialtyEvidenceReview(evidence,test.components,selectedTable);
      return {testCode:test.code,review} as const;
    },{isolationLevel:"RepeatableRead",timeout:30_000});
    if("error" in outcome&&typeof outcome.error==="string"&&typeof outcome.status==="number")
      return fail(outcome.error,outcome.status);
    if(!("review" in outcome)||!outcome.review||!("testCode" in outcome))
      return fail("specialty_review_unavailable",409);
    return NextResponse.json({status:"review_only",
      testCode:outcome.testCode,...outcome.review,
      warnings:[
        "The selected legacy source table is an operator choice, not an approved test-to-source mapping.",
        "No ranges, source observation values, units or specimen methods are returned or saved.",
        "An exact component code match alone is not clinical approval or an accepted reference interval.",
        "Unrepresented configured components may be qualitative or text-only; do not infer missing clinical tests.",
        "Source MDB SHA256 is supplied by the local exporter and not independently verified here.",
        "No catalog, reference interval, result, historical report or financial master was created or changed.",
      ],
    },{headers:{"Cache-Control":"private, no-store"}});
  }catch(e){
    return fail(e instanceof LegacySpecialtyEvidenceError?e.code:"specialty_evidence_review_failed",400);
  }

}
