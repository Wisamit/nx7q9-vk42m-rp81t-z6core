import { NextResponse } from "next/server";
import { requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { validDoctorAccessDates, validDoctorAccessReason } from "@/lib/doctor-portal-access";

class AccessError extends Error {
  constructor(readonly code: string, readonly statusCode = 409) {super(code);}
}
function uuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
}
export async function POST(request: Request) {
  const session = await requirePermission("portal_accounts.manage");
  const organizationId = session.user.organizationId;
  const branchId = session.activeBranchId;
  if (!branchId || !session.user.branchScopes.some(scope =>
    scope.branchId === branchId && scope.branch.status === "ACTIVE" &&
    scope.branch.organizationId === organizationId))
    return NextResponse.json({error:"active_branch_scope_required"},{status:403});
  const body: unknown = await request.json().catch(()=>null);
  if (!body || typeof body !== "object" || Array.isArray(body))
    return NextResponse.json({error:"invalid_request"},{status:400});
  const input=body as Record<string,unknown>;
  if (!uuid(input.referrerId) || !uuid(input.patientId) ||
    !validDoctorAccessReason(input.reason) ||
    (input.canViewOrders !== true && input.canViewReports !== true) ||
    (input.canViewOrders !== undefined && typeof input.canViewOrders !== "boolean") ||
    (input.canViewReports !== undefined && typeof input.canViewReports !== "boolean"))
    return NextResponse.json({error:"invalid_doctor_grant"},{status:400});
  const start=typeof input.effectiveFrom==="string" ? new Date(input.effectiveFrom) : new Date();
  const end=typeof input.effectiveTo==="string" && input.effectiveTo ? new Date(input.effectiveTo) : null;
  if (!validDoctorAccessDates(start,end))
    return NextResponse.json({error:"invalid_effective_dates"},{status:400});
  const ctx=await requestContext();
  try {
    const created=await prisma.$transaction(async tx=>{
      const org=await tx.$queryRaw<Array<{id:string}>>`
        SELECT id FROM organizations WHERE id=${organizationId} AND status='ACTIVE' FOR UPDATE
      `;
      const branch=await tx.$queryRaw<Array<{id:string}>>`
        SELECT id FROM branches WHERE id=${branchId}
        AND organization_id=${organizationId} AND status='ACTIVE' FOR UPDATE
      `;
      const grant=await tx.userBranchScope.findUnique({
        where:{userId_branchId:{userId:session.user.id,branchId}},select:{branchId:true},
      });
      if(org.length!==1||branch.length!==1||!grant)
        throw new AccessError("active_branch_scope_required",403);
      const referrer=await tx.$queryRaw<Array<{id:string}>>`
        SELECT id FROM referrers WHERE id=${input.referrerId}
        AND organization_id=${organizationId} AND type='PHYSICIAN'
        AND status='ACTIVE' FOR UPDATE
      `;
      const patient=await tx.$queryRaw<Array<{id:string}>>`
        SELECT id FROM patients WHERE id=${input.patientId}
        AND organization_id=${organizationId} AND status='ACTIVE' FOR UPDATE
      `;
      if(referrer.length!==1||patient.length!==1)
        throw new AccessError("doctor_or_patient_not_found",404);
      const portal=await tx.portalAccount.findFirst({
        where:{organizationId,referrerId:input.referrerId as string,type:"DOCTOR",
          status:{not:"DISABLED"}},select:{id:true},
      });
      if(!portal)throw new AccessError("doctor_portal_account_required",409);
      const existing=await tx.doctorPortalPatientAccess.findFirst({
        where:{organizationId,referrerId:input.referrerId as string,
          patientId:input.patientId as string,status:"ACTIVE"},
        select:{id:true},
      });
      if(existing)throw new AccessError("active_grant_already_exists",409);
      const row=await tx.doctorPortalPatientAccess.create({data:{
        organizationId,referrerId:input.referrerId as string,
        patientId:input.patientId as string,
        canViewOrders:input.canViewOrders===true,
        canViewReports:input.canViewReports===true,
        effectiveFrom:start,effectiveTo:end,
        reason:(input.reason as string).trim(),createdByUserId:session.user.id,
      }});
      await tx.auditEvent.create({data:{
        organizationId,branchId,actorUserId:session.user.id,
        action:"DOCTOR_PATIENT_PORTAL_ACCESS_GRANTED",
        entityType:"DoctorPortalPatientAccess",entityId:row.id,
        reason:row.reason,newValues:{
          referrerId:row.referrerId,patientId:row.patientId,
          canViewOrders:row.canViewOrders,canViewReports:row.canViewReports,
          effectiveFrom:start.toISOString(),effectiveTo:end?.toISOString()??null,
        },ipAddress:ctx.ipAddress,userAgent:ctx.userAgent,
      }});
      return row;
    },{isolationLevel:"Serializable",timeout:45000});
    return NextResponse.json({status:"ok",access:created},{status:201,
      headers:{"Cache-Control":"private, no-store"}});
  }catch(error){
    if(error instanceof AccessError)
      return NextResponse.json({error:error.code},{status:error.statusCode});
    return NextResponse.json({error:"doctor_access_conflict"},{status:409});
  }
}
export async function PATCH(request: Request) {
  const session=await requirePermission("portal_accounts.manage");
  const orgId=session.user.organizationId,branchId=session.activeBranchId;
  if(!branchId || !session.user.branchScopes.some(s=>s.branchId===branchId &&
    s.branch.status==="ACTIVE"&&s.branch.organizationId===orgId))
    return NextResponse.json({error:"active_branch_scope_required"},{status:403});
  const body: unknown=await request.json().catch(()=>null);
  if(!body || typeof body!=="object"||Array.isArray(body))
    return NextResponse.json({error:"invalid_request"},{status:400});
  const input=body as Record<string,unknown>;
  if(!uuid(input.id)||!validDoctorAccessReason(input.reason))
    return NextResponse.json({error:"invalid_revoke_request"},{status:400});
  const ctx=await requestContext();
  try{
    const revoked=await prisma.$transaction(async tx=>{
      const org=await tx.$queryRaw<Array<{id:string}>>`
        SELECT id FROM organizations WHERE id=${orgId} AND status='ACTIVE' FOR UPDATE
      `;
      const branch=await tx.$queryRaw<Array<{id:string}>>`
        SELECT id FROM branches WHERE id=${branchId}
        AND organization_id=${orgId} AND status='ACTIVE' FOR UPDATE
      `;
      const grant=await tx.userBranchScope.findUnique({
        where:{userId_branchId:{userId:session.user.id,branchId}},select:{branchId:true},
      });
      if(org.length!==1||branch.length!==1||!grant)
        throw new AccessError("active_branch_scope_required",403);
      const locked=await tx.$queryRaw<Array<{id:string}>>`
        SELECT id FROM doctor_portal_patient_access
        WHERE id=${input.id} AND organization_id=${orgId} FOR UPDATE
      `;
      if(locked.length!==1)throw new AccessError("doctor_access_not_found",404);
      const row=await tx.doctorPortalPatientAccess.findFirst({
        where:{id:input.id as string,organizationId:orgId,status:"ACTIVE"},
      });
      if(!row)throw new AccessError("doctor_access_already_revoked");
      const now=new Date();
      const updated=await tx.doctorPortalPatientAccess.update({
        where:{id:row.id},data:{status:"INACTIVE",revokedAt:now,
          revokedByUserId:session.user.id,revokeReason:(input.reason as string).trim()},
      });
      await tx.auditEvent.create({data:{
        organizationId:orgId,branchId,actorUserId:session.user.id,
        action:"DOCTOR_PATIENT_PORTAL_ACCESS_REVOKED",
        entityType:"DoctorPortalPatientAccess",entityId:row.id,
        reason:updated.revokeReason,
        oldValues:{status:row.status,canViewOrders:row.canViewOrders,
          canViewReports:row.canViewReports},
        newValues:{status:"INACTIVE",revokedAt:now.toISOString()},
        ipAddress:ctx.ipAddress,userAgent:ctx.userAgent,
      }});
      return updated;
    },{isolationLevel:"Serializable",timeout:45000});
    return NextResponse.json({status:"ok",access:revoked},{headers:{"Cache-Control":"private, no-store"}});
  }catch(error){
    if(error instanceof AccessError)return NextResponse.json({error:error.code},{status:error.statusCode});
    return NextResponse.json({error:"doctor_access_conflict"},{status:409});
  }
}
