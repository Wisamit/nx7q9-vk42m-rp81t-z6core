import { NextResponse } from "next/server";
import { getCurrentPortalSession } from "@/lib/portal-auth";
import { requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { hasLiveDoctorPortalReferrer } from "@/lib/doctor-portal-access";
import {
  DoctorRequisitionError, doctorRequisitionFingerprint, isUuid,
  parseDoctorRequisition,
} from "@/lib/doctor-requisition";

async function requireDoctorPortal() {
  const session = await getCurrentPortalSession();
  if (!session || session.portalAccount.mustChangePassword ||
      !hasLiveDoctorPortalReferrer(session.portalAccount))
    throw new DoctorRequisitionError("doctor_portal_unauthorized", 403);
  return session;
}
function failure(error:unknown) {
  if (error instanceof DoctorRequisitionError)
    return NextResponse.json({error:error.code},{status:error.statusCode});
  return NextResponse.json({error:"requisition_concurrent_conflict"},{status:409});
}

export async function GET(request: Request) {
  try {
    const session = await requireDoctorPortal();
    const account = session.portalAccount, now=new Date();
    const url=new URL(request.url);
    const rawPage=Number(url.searchParams.get("page")||"1");
    if (!Number.isSafeInteger(rawPage) || rawPage<1 || rawPage>10000)
      throw new DoctorRequisitionError("invalid_page",400);
    const where = {
      organizationId: account.organizationId, portalAccountId: account.id,
      patient: { doctorPortalAccess: { some: {
        organizationId: account.organizationId, referrerId: account.referrerId!,
        canRequestOrders:true, status:"ACTIVE" as const,
        effectiveFrom:{lte:now}, OR:[{effectiveTo:null},{effectiveTo:{gte:now}}],
      } } },
    };
    const [count, requests]=await Promise.all([
      prisma.doctorRequisition.count({where}),
      prisma.doctorRequisition.findMany({
        where,orderBy:[{submittedAt:"desc"},{id:"desc"}],
        skip:(rawPage-1)*50,take:50,
        include:{patient:{select:{patientNumber:true,fullNameEn:true,fullNameAr:true}},
          branch:{select:{code:true,nameEn:true,nameAr:true}},
          items:{orderBy:{testCodeSnapshot:"asc"}}},
      }),
    ]);
    return NextResponse.json({page:rawPage,total:count,requests},
      {headers:{"Cache-Control":"private, no-store"}});
  } catch(e){return failure(e);}
}
export async function POST(request:Request) {
  try{
    const session=await requireDoctorPortal();
    const account=session.portalAccount;
    const input=parseDoctorRequisition(await request.json().catch(()=>null));
    const ctx=await requestContext();
    const fingerprint=doctorRequisitionFingerprint(input,account.referrerId!,account.id);
    const result=await prisma.$transaction(async tx=>{
      const org=await tx.$queryRaw<Array<{id:string}>>`
        SELECT id FROM organizations WHERE id=${account.organizationId}
        AND status='ACTIVE' FOR UPDATE`;
      const branch=await tx.$queryRaw<Array<{id:string}>>`
        SELECT id FROM branches WHERE id=${input.branchId}
        AND organization_id=${account.organizationId} AND status='ACTIVE' FOR UPDATE`;
      const referrer=await tx.$queryRaw<Array<{id:string}>>`
        SELECT id FROM referrers WHERE id=${account.referrerId}
        AND organization_id=${account.organizationId} AND type='PHYSICIAN'
        AND status='ACTIVE' FOR UPDATE`;
      const patient=await tx.$queryRaw<Array<{id:string}>>`
        SELECT id FROM patients WHERE id=${input.patientId}
        AND organization_id=${account.organizationId} AND status='ACTIVE' FOR UPDATE`;
      if(org.length!==1||branch.length!==1||referrer.length!==1||patient.length!==1)
        throw new DoctorRequisitionError("request_context_unavailable",404);
      const grant=await tx.$queryRaw<Array<{id:string}>>`
        SELECT id FROM doctor_portal_patient_access
        WHERE organization_id=${account.organizationId}
          AND referrer_id=${account.referrerId} AND patient_id=${input.patientId}
          AND can_request_orders=TRUE AND status='ACTIVE'
          AND effective_from <= NOW(3)
          AND (effective_to IS NULL OR effective_to >= NOW(3))
        ORDER BY effective_from DESC LIMIT 1 FOR UPDATE`;
      if(grant.length!==1) throw new DoctorRequisitionError("patient_requisition_not_authorized",403);
      const existing=await tx.doctorRequisition.findUnique({
        where:{portalAccountId_clientRequestId:{
          portalAccountId:account.id,clientRequestId:input.clientRequestId}},
        select:{id:true,status:true,requestFingerprint:true},
      });
      if(existing) {
        if(existing.requestFingerprint!==fingerprint)
          throw new DoctorRequisitionError("request_token_payload_mismatch");
        return {id:existing.id,status:existing.status,replayed:true};
      }
      const tests=await tx.labTest.findMany({
        where:{id:{in:input.testIds},organizationId:account.organizationId,status:"ACTIVE"},
        select:{id:true,code:true,nameEn:true,nameAr:true},
      });
      if(tests.length!==input.testIds.length)
        throw new DoctorRequisitionError("requested_test_unavailable",409);
      const row=await tx.doctorRequisition.create({data:{
        organizationId:account.organizationId,branchId:input.branchId,
        patientId:input.patientId,referrerId:account.referrerId!,
        portalAccountId:account.id,clientRequestId:input.clientRequestId,
        requestFingerprint:fingerprint,priority:input.priority,
        diagnosis:input.diagnosis,clinicalNotes:input.clinicalNotes,
        items:{create:tests.map(test=>({
          testId:test.id,testCodeSnapshot:test.code,
          testNameEnSnapshot:test.nameEn,testNameArSnapshot:test.nameAr,
        }))},
      }});
      await tx.auditEvent.create({data:{
        organizationId:account.organizationId,branchId:input.branchId,
        actorUserId:null,entityType:"DoctorRequisition",entityId:row.id,
        action:"DOCTOR_ELECTRONIC_REQUISITION_SUBMITTED",
        sessionId:session.id,ipAddress:ctx.ipAddress,userAgent:ctx.userAgent,
        newValues:{patientId:input.patientId,referrerId:account.referrerId,
          testCodes:tests.map(x=>x.code),priority:input.priority,
          requestFingerprint:fingerprint,status:"SUBMITTED",
          financialEffect:"NONE",clinicalOrderCreated:false},
      }});
      return {id:row.id,status:row.status,replayed:false};
    },{isolationLevel:"Serializable",timeout:45000});
    return NextResponse.json(result,{status:result.replayed?200:201,
      headers:{"Cache-Control":"private, no-store"}});
  }catch(e){return failure(e);}
}
export async function PATCH(request:Request) {
  try {
    const session=await requireDoctorPortal(), account=session.portalAccount;
    const raw:unknown=await request.json().catch(()=>null);
    if (!raw || typeof raw!=="object" || Array.isArray(raw) ||
        !isUuid((raw as Record<string,unknown>).id))
      throw new DoctorRequisitionError("invalid_cancellation",400);
    const id=(raw as {id:string}).id,ctx=await requestContext();
    const row=await prisma.$transaction(async tx=>{
      const lock=await tx.$queryRaw<Array<{id:string}>>`
        SELECT id FROM doctor_requisitions WHERE id=${id}
        AND organization_id=${account.organizationId}
        AND portal_account_id=${account.id} FOR UPDATE`;
      if(lock.length!==1)throw new DoctorRequisitionError("requisition_not_found",404);
      const change=await tx.doctorRequisition.updateMany({
        where:{id,organizationId:account.organizationId,portalAccountId:account.id,status:"SUBMITTED"},
        data:{status:"CANCELLED",resolvedAt:new Date(),
          resolutionReason:"Cancelled by submitting physician"},
      });
      if(change.count!==1)throw new DoctorRequisitionError("requisition_not_pending");
      const found=await tx.doctorRequisition.findUniqueOrThrow({where:{id}});
      await tx.auditEvent.create({data:{
        organizationId:account.organizationId,branchId:found.branchId,
        actorUserId:null,action:"DOCTOR_ELECTRONIC_REQUISITION_CANCELLED",
        entityType:"DoctorRequisition",entityId:id,sessionId:session.id,
        ipAddress:ctx.ipAddress,userAgent:ctx.userAgent,
        oldValues:{status:"SUBMITTED"},newValues:{status:"CANCELLED"},
      }});
      return found;
    },{isolationLevel:"Serializable",timeout:45000});
    return NextResponse.json({id:row.id,status:row.status},
      {headers:{"Cache-Control":"private, no-store"}});
  }catch(e){return failure(e);}
}
