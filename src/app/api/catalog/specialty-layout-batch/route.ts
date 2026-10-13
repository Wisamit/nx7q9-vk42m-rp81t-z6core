import { NextResponse } from "next/server";
import { Prisma } from "../../../../../generated/prisma/client";
import { canAccessBranch, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  parseSpecialtyLayoutPlan, specialtyPlanPreview, specialtyReviewToken, specialtySnapshotDigest,
  SpecialtyPlanError, type SpecialtySnapshot, type SpecialtyLayoutPlan,
} from "@/lib/specialty-layout-review";

type Db = Prisma.TransactionClient | typeof prisma;
function responseError(error:string,status:number){return NextResponse.json({error},{status});}
async function currentLayout(db:Db,testId:string,organizationId:string):Promise<SpecialtySnapshot|null>{
  const test=await db.labTest.findFirst({
    where:{id:testId,organizationId,status:"ACTIVE"},
    select:{
      resultEntryLayout:true,updatedAt:true,
      resultSections:{select:{id:true,code:true,nameEn:true,nameAr:true,displayOrder:true,columnCount:true,
        hintEn:true,hintAr:true,status:true,updatedAt:true,reportVisible:true,reportDisplayOrder:true}},
      components:{select:{id:true,code:true,status:true,resultSectionId:true,entryWidth:true,entryHintEn:true,
        entryHintAr:true,updatedAt:true,reportVisible:true,reportDisplayOrder:true,reportNameEn:true,reportNameAr:true}},
    },
  });
  if(!test)return null;
  const sectionById=new Map(test.resultSections.map(s=>[s.id,s.code]));
  return {
    layout:test.resultEntryLayout,testUpdatedAt:test.updatedAt.toISOString(),
    sections:test.resultSections.map(s=>({...s,updatedAt:s.updatedAt.toISOString()})),
    components:test.components.map(c=>({
      id:c.id,code:c.code,status:c.status,updatedAt:c.updatedAt.toISOString(),
      resultSectionId:c.resultSectionId,sectionCode:c.resultSectionId?sectionById.get(c.resultSectionId)||null:null,
      entryWidth:c.entryWidth,entryHintEn:c.entryHintEn,entryHintAr:c.entryHintAr,
      reportNameEn:c.reportNameEn,reportNameAr:c.reportNameAr,
      reportVisible:c.reportVisible,reportDisplayOrder:c.reportDisplayOrder,
    })),
  };
}
export async function POST(request:Request){
  const session=await requirePermission("catalog.manage");
  if(!session.activeBranchId||!canAccessBranch(session,session.activeBranchId))
    return responseError("active_branch_scope_required",403);
  const length=Number(request.headers.get("content-length")||"0");
  if(length>550_000)return responseError("layout_request_too_large",413);
  const raw:unknown=await request.json().catch(()=>null);
  if(!raw||typeof raw!=="object"||Array.isArray(raw))return responseError("invalid_request",400);
  const body=raw as Record<string,unknown>;
  const testId=typeof body.testId==="string"?body.testId:"";
  if(!/^[0-9a-f-]{36}$/i.test(testId))return responseError("invalid_test_id",400);
  const mode=body.mode;
  if(mode!=="PREVIEW"&&mode!=="APPLY")return responseError("invalid_mode",400);
  const org=session.user.organizationId;
  if(mode==="PREVIEW"){
    const snapshot=await currentLayout(prisma,testId,org);
    if(!snapshot)return responseError("active_test_not_found",404);
    try{
      const plan=parseSpecialtyLayoutPlan(body.plan,snapshot),fingerprint=specialtySnapshotDigest(snapshot);
      return NextResponse.json({status:"review",fingerprint,reviewToken:specialtyReviewToken(fingerprint,plan),
        preview:specialtyPlanPreview(snapshot,plan)},{headers:{"Cache-Control":"no-store"}});
    }catch(e){return responseError(e instanceof SpecialtyPlanError?e.code:"invalid_specialty_layout_plan",400);}
  }
  const fingerprint=body.fingerprint,reviewToken=body.reviewToken;
  if(typeof fingerprint!=="string"||!/^[a-f0-9]{64}$/.test(fingerprint)
      ||typeof reviewToken!=="string"||!/^[a-f0-9]{64}$/.test(reviewToken)
      ||body.confirm!=="APPLY_REVIEWED_LAYOUT")return responseError("review_confirmation_required",409);
  const ctx=await requestContext();
  try{
    const result=await prisma.$transaction(async tx=>{
      // Lock the catalog root and all existing presentation rows before re-reading the review fingerprint.
      await tx.$queryRaw`SELECT id FROM lab_tests WHERE id=${testId} AND organization_id=${org} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM test_result_sections WHERE test_id=${testId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM test_components WHERE test_id=${testId} FOR UPDATE`;
      const actor=await tx.user.findFirst({where:{
        id:session.userId,organizationId:org,status:"ACTIVE",
        roles:{some:{role:{organizationId:org,status:"ACTIVE",permissions:{some:{permission:{code:"catalog.manage"}}}}}},
        branchScopes:{some:{branchId:session.activeBranchId!,branch:{organizationId:org,status:"ACTIVE"}}},
      },select:{id:true}});
      if(!actor)throw new SpecialtyPlanError("catalog_authority_revoked");
      const snapshot=await currentLayout(tx,testId,org);
      if(!snapshot)throw new SpecialtyPlanError("active_test_not_found");
      if(specialtySnapshotDigest(snapshot)!==fingerprint)throw new SpecialtyPlanError("layout_changed_repreview_required");
      const plan=parseSpecialtyLayoutPlan(body.plan,snapshot);
      if(specialtyReviewToken(fingerprint,plan)!==reviewToken)
        throw new SpecialtyPlanError("reviewed_plan_changed");
      const review=specialtyPlanPreview(snapshot,plan);
      const originals=new Map(snapshot.sections.map(s=>[s.code,s]));
      const updatedSectionIds=new Map(snapshot.sections.map(s=>[s.code,s.id]));
      for(const section of plan.sections){
        const prior=originals.get(section.code);
        if(!prior){
          const created=await tx.testResultSection.create({data:{testId, ...section}});
          updatedSectionIds.set(section.code,created.id);
        }else if(review.sectionsUpdated.includes(section.code)){
          await tx.testResultSection.update({where:{id:prior.id},data:{
            nameEn:section.nameEn,nameAr:section.nameAr,displayOrder:section.displayOrder,
            columnCount:section.columnCount,hintEn:section.hintEn,hintAr:section.hintAr,
          }});
        }
      }
      const componentByCode=new Map(snapshot.components.map(c=>[c.code,c]));
      for(const component of plan.components){
        if(!review.componentsUpdated.includes(component.code))continue;
        const prior=componentByCode.get(component.code);
        if(!prior)throw new SpecialtyPlanError("component_snapshot_missing");
        const targetId=component.sectionCode?updatedSectionIds.get(component.sectionCode):null;
        if(component.sectionCode&&!targetId)throw new SpecialtyPlanError("planned_section_not_found");
        await tx.testComponent.update({where:{id:prior.id},data:{
          resultSectionId:targetId||null,entryWidth:component.entryWidth,
          entryHintEn:component.entryHintEn,entryHintAr:component.entryHintAr,
        }});
      }
      if(review.layoutChanged)await tx.labTest.update({where:{id:testId},data:{resultEntryLayout:plan.layout}});
      await tx.auditEvent.create({data:{
        organizationId:org,branchId:session.activeBranchId,actorUserId:session.userId,
        action:"SPECIALIZED_RESULT_LAYOUT_BATCH_APPLIED",entityType:"LabTest",entityId:testId,
        oldValues:{fingerprint,layout:snapshot.layout,
          existingSectionCodes:snapshot.sections.filter(s=>s.status==="ACTIVE").map(s=>s.code)},
        newValues:{layout:plan.layout,sectionsCreated:review.sectionsCreated,
          sectionsUpdated:review.sectionsUpdated,componentsUpdated:review.componentsUpdated,
          unchangedActiveSections:review.unchangedActiveSections,reviewToken,affected:review.affected},
        reason:"Operator reviewed a complete component mapping and acknowledged future presentation changes",
        ipAddress:ctx.ipAddress,userAgent:ctx.userAgent,
      }});
      return review;
    },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:30_000});
    return NextResponse.json({status:"applied",preview:result});
  }catch(e){
    const reason=e instanceof SpecialtyPlanError?e.code:"layout_batch_conflict";
    return responseError(reason,reason==="active_test_not_found"?404:409);
  }
}
