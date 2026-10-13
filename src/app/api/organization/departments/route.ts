import { NextResponse } from "next/server";
import { Prisma } from "../../../../../generated/prisma/client";
import { getCurrentSession, permissionSet, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { authorizedBranchIds, canManageBranch, inputText, organizationBranchAdmin, validCode } from "@/lib/branch-administration";

const error = (message:string,status:number)=>NextResponse.json({error:message},{status});

export async function GET() {
  const session=await getCurrentSession();
  if(!session) return error("unauthorized",401);
  if(!permissionSet(session).has("branches.view")&&!permissionSet(session).has("branches.manage")) return error("forbidden",403);
  const org=session.user.organizationId,all=organizationBranchAdmin(session),allowed=authorizedBranchIds(session);
  const departments=await prisma.department.findMany({
    where:{organizationId:org,...(all?{}:{OR:[{branchId:null},{branchId:{in:allowed}}]})},
    select:{id:true,code:true,nameEn:true,nameAr:true,status:true,branchId:true,updatedAt:true},
    orderBy:[{status:"asc"},{code:"asc"}],take:500,
  });
  return NextResponse.json({departments},{headers:{"Cache-Control":"no-store"}});
}

export async function POST(request:Request) {
  const session=await getCurrentSession();
  if(!session) return error("unauthorized",401);
  if(!permissionSet(session).has("branches.manage")) return error("forbidden",403);
  const raw:unknown=await request.json().catch(()=>null);
  if(!raw||typeof raw!=="object"||Array.isArray(raw)) return error("invalid_request",400);
  const data=raw as Record<string,unknown>;
  const org=session.user.organizationId;
  const code=validCode(data.code),nameEn=inputText(data.nameEn,150,true),nameAr=inputText(data.nameAr,150);
  const branchId=data.branchId===null||data.branchId===""?null:typeof data.branchId==="string"?data.branchId:null;
  if(!code||!nameEn||nameAr===null||(data.branchId!==null&&data.branchId!==""&&typeof data.branchId!=="string")
    ||(branchId!==null&&!/^[0-9a-f-]{36}$/i.test(branchId))) return error("invalid_department_fields",400);
  if(branchId===null&&!organizationBranchAdmin(session)) return error("organization_admin_required_for_shared_department",403);
  if(branchId&&!canManageBranch(session,branchId)) return error("branch_forbidden",403);
  const ctx=await requestContext();
  try{
    const department=await prisma.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM organizations WHERE id=${org} AND status='ACTIVE' FOR UPDATE`;
      const branch=branchId?await tx.branch.findFirst({where:{id:branchId,organizationId:org,status:"ACTIVE"}}):null;
      if(branchId&&!branch) throw Error("invalid_branch");
      const actor=await tx.user.findFirst({where:{id:session.userId,organizationId:org,status:"ACTIVE"}});
      const grant=branchId?await tx.userBranchScope.findUnique({where:{userId_branchId:{userId:session.userId,branchId}}}):null;
      const sys=await tx.userRole.findFirst({where:{userId:session.userId,role:{organizationId:org,code:"SYSTEM_ADMIN",isSystem:true,status:"ACTIVE"}}});
      if(!actor||(!grant&&!sys)) throw Error("authorization_changed");
      const d=await tx.department.create({data:{organizationId:org,branchId,code,nameEn,nameAr:nameAr||null}});
      await tx.auditEvent.create({data:{organizationId:org,branchId:branchId||session.activeBranchId,actorUserId:session.userId,
        action:"DEPARTMENT_CREATED",entityType:"Department",entityId:d.id,
        newValues:{code,nameEn,nameAr:nameAr||null,branchId},reason:"Configured laboratory department",
        ipAddress:ctx.ipAddress,userAgent:ctx.userAgent}});
      return d;
    },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
    return NextResponse.json({status:"ok",departmentId:department.id},{status:201});
  }catch{return error("department_create_conflict",409);}
}

export async function PATCH(request:Request) {
  const session=await getCurrentSession();
  if(!session) return error("unauthorized",401);
  if(!permissionSet(session).has("branches.manage")) return error("forbidden",403);
  const raw:unknown=await request.json().catch(()=>null);
  if(!raw||typeof raw!=="object"||Array.isArray(raw)) return error("invalid_request",400);
  const data=raw as Record<string,unknown>;
  const id=typeof data.id==="string"?data.id:"";
  if(!/^[0-9a-f-]{36}$/i.test(id)) return error("invalid_department",400);
  const operation=data.operation;
  if(!["update","deactivate","reactivate"].includes(String(operation))) return error("invalid_operation",400);
  if(data.code!==undefined||data.branchId!==undefined) return error("department_code_and_scope_immutable",400);
  const nameEn=operation==="update"?inputText(data.nameEn,150,true):null;
  const nameAr=operation==="update"?inputText(data.nameAr,150):null;
  if(operation==="update"&&(!nameEn||nameAr===null)) return error("invalid_department_fields",400);
  const reason=operation==="deactivate"?inputText(data.reason,1000,true):"";
  if(operation==="deactivate"&&(!reason||reason.length<15)) return error("documented_deactivation_reason_required",400);
  const org=session.user.organizationId,ctx=await requestContext();
  try{
    await prisma.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM departments WHERE id=${id} AND organization_id=${org} FOR UPDATE`;
      const department=await tx.department.findFirst({where:{id,organizationId:org}});
      if(!department) throw Error("department_not_found");
      if(department.branchId&&!canManageBranch(session,department.branchId)) throw Error("branch_forbidden");
      if(!department.branchId&&!organizationBranchAdmin(session)) throw Error("organization_admin_required");
      const actor=await tx.user.findFirst({where:{id:session.userId,organizationId:org,status:"ACTIVE"}});
      const currentAdmin=await tx.userRole.findFirst({where:{userId:session.userId,role:{organizationId:org,code:"SYSTEM_ADMIN",isSystem:true,status:"ACTIVE"}}});
      const scope=department.branchId?await tx.userBranchScope.findUnique({where:{userId_branchId:{userId:session.userId,branchId:department.branchId}}}):null;
      if(!actor||(!currentAdmin&&!scope)) throw Error("authorization_changed");
      const newStatus=operation==="deactivate"?"INACTIVE":operation==="reactivate"?"ACTIVE":department.status;
      if(operation==="deactivate"){
        if(department.status!=="ACTIVE") throw Error("department_not_active");
        const counts=await Promise.all([
          tx.labTest.count({where:{departmentId:id,status:"ACTIVE"}}),
          tx.analyzer.count({where:{departmentId:id,status:"ACTIVE"}}),
          tx.equipment.count({where:{departmentId:id,status:"ACTIVE"}}),
          tx.workstation.count({where:{departmentId:id,status:"ACTIVE"}}),
          tx.userDepartmentScope.count({where:{departmentId:id}}),
          tx.resultValidationPolicy.count({where:{departmentId:id,status:"ACTIVE"}}),
        ]);
        if(counts.some(n=>n>0)) throw Error("department_has_active_dependencies");
      }
      if(operation==="reactivate"&&department.status!=="INACTIVE") throw Error("department_not_inactive");
      if(operation==="reactivate"&&department.branchId){
        const branch=await tx.branch.findFirst({where:{id:department.branchId,organizationId:org,status:"ACTIVE"}});
        if(!branch) throw Error("branch_inactive");
      }
      if(operation==="update"&&department.status!=="ACTIVE") throw Error("department_inactive");
      await tx.department.update({where:{id},data:operation==="update"?{nameEn:nameEn!,nameAr:nameAr||null}:{status:newStatus,deactivatedAt:newStatus==="INACTIVE"?new Date():null}});
      await tx.auditEvent.create({data:{organizationId:org,branchId:department.branchId||session.activeBranchId,actorUserId:session.userId,
        action:operation==="update"?"DEPARTMENT_UPDATED":operation==="deactivate"?"DEPARTMENT_DEACTIVATED":"DEPARTMENT_REACTIVATED",
        entityType:"Department",entityId:id,
        oldValues:{nameEn:department.nameEn,nameAr:department.nameAr,status:department.status},
        newValues:{nameEn:operation==="update"?nameEn:department.nameEn,nameAr:operation==="update"?nameAr||null:department.nameAr,status:newStatus},
        reason:reason||"Department master data update",ipAddress:ctx.ipAddress,userAgent:ctx.userAgent}});
    },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
    return NextResponse.json({status:"ok"});
  }catch(e){return error(e instanceof Error?e.message:"department_update_conflict",409);}
}
