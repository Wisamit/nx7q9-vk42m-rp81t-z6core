import { compare } from "bcryptjs";
import { NextResponse } from "next/server";
import { getCurrentSession, permissionSet, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { decryptSecret, verifyTotp } from "@/lib/staff-mfa";
import { newStepUpToken, STEP_UP_FAILURE_LIMIT, STEP_UP_TTL_MS,
  STEP_UP_WINDOW_MS, stepUpHash, stepUpPermissions, validStepUpAction,
  validStepUpResource } from "@/lib/staff-step-up";

const headers={"Cache-Control":"private, no-store"};
export async function POST(request:Request){
  const session=await getCurrentSession();
  if(!session)return NextResponse.json({error:"unauthorized"},{status:401,headers});
  const contentLength=Number(request.headers.get("content-length")||"0");
  if(contentLength>2048)return NextResponse.json({error:"invalid_step_up_request"},{status:413,headers});
  const raw:unknown=await request.json().catch(()=>null);
  if(!raw||typeof raw!=="object"||Array.isArray(raw))
    return NextResponse.json({error:"invalid_step_up_request"},{status:400,headers});
  const input=raw as Record<string,unknown>;
  if(!validStepUpAction(input.action)||!validStepUpResource(input.action,input.resourceKey)||
      typeof input.branchId!=="string"||!(/^[0-9a-f-]{36}$/i.test(input.branchId))||
      typeof input.password!=="string"||input.password.length<1||input.password.length>256||
      (input.totp!==undefined && (typeof input.totp!=="string"||input.totp.length>20)))
    return NextResponse.json({error:"invalid_step_up_request"},{status:400,headers});
  if(!permissionSet(session).has(stepUpPermissions[input.action]))
    return NextResponse.json({error:"step_up_permission_forbidden"},{status:403,headers});
  const action=input.action as keyof typeof stepUpPermissions;
  const branchId=input.branchId as string;
  if(session.activeBranchId!==branchId||
      !session.user.branchScopes.some(s=>s.branchId===branchId&&
        s.branch.organizationId===session.user.organizationId&&s.branch.status==="ACTIVE"))
    return NextResponse.json({error:"step_up_active_branch_required"},{status:403,headers});

  const ctx=await requestContext(),now=new Date(),resourceKey=input.resourceKey as string;
  const token=newStepUpToken();
  const result=await prisma.$transaction(async tx=>{
    // Serialize attempts for ALL sessions of this user to prevent distributed
    // password/TOTP guessing across application instances.
    const userRows=await tx.$queryRaw<Array<{id:string}>>`
      SELECT id FROM users WHERE id=${session.user.id}
        AND organization_id=${session.user.organizationId}
        AND status='ACTIVE' FOR UPDATE
    `;
    if(userRows.length!==1)return {error:"step_up_unavailable",httpStatus:403} as const;
    const [currentSession,currentUser,scope,branch]=await Promise.all([
      tx.userSession.findFirst({where:{id:session.id,userId:session.user.id,revokedAt:null,
        expiresAt:{gt:now}},select:{activeBranchId:true}}),
      tx.user.findFirst({where:{id:session.user.id,organizationId:session.user.organizationId,
        status:"ACTIVE"},select:{passwordHash:true,mfaEnabled:true,mfaSecretEncrypted:true,
          lockedUntil:true}}),
      tx.userBranchScope.findUnique({where:{userId_branchId:{
        userId:session.user.id,branchId}},select:{userId:true}}),
      tx.branch.findFirst({where:{id:branchId,organizationId:session.user.organizationId,
        status:"ACTIVE"},select:{id:true}}),
    ]);
    if(!currentSession||currentSession.activeBranchId!==branchId||!scope||!branch||!currentUser)
      return {error:"step_up_scope_changed",httpStatus:403} as const;
    if(currentUser.lockedUntil&&currentUser.lockedUntil>now)
      return {error:"step_up_temporarily_locked",httpStatus:429} as const;
    const failed=await tx.staffStepUpAttempt.count({where:{
      userId:session.user.id,success:false,createdAt:{gte:new Date(now.getTime()-STEP_UP_WINDOW_MS)},
    }});
    if(failed>=STEP_UP_FAILURE_LIMIT)
      return {error:"step_up_temporarily_locked",httpStatus:429} as const;
    let valid=!!currentUser.passwordHash&&
      await compare(input.password as string,currentUser.passwordHash);
    let proofMethod="PASSWORD";
    if(currentUser.mfaEnabled){
      proofMethod="PASSWORD_TOTP";
      if(!currentUser.mfaSecretEncrypted||typeof input.totp!=="string")valid=false;
      else {
        try{valid=valid&&verifyTotp(decryptSecret(currentUser.mfaSecretEncrypted),
          input.totp.trim(),now.getTime());}
        catch{valid=false;}
      }
    }
    await tx.staffStepUpAttempt.create({data:{
      userId:session.user.id,sessionId:session.id,success:valid,
    }});
    if(!valid){
      await tx.auditEvent.create({data:{
        organizationId:session.user.organizationId,branchId,actorUserId:session.user.id,
        action:"STAFF_STEP_UP_DENIED",entityType:"UserSession",entityId:session.id,
        newValues:{action:action},ipAddress:ctx.ipAddress,userAgent:ctx.userAgent,
      }});
      return {error:"step_up_invalid_credentials",httpStatus:401} as const;
    }
    const grant=await tx.staffStepUpGrant.create({data:{
      userId:session.user.id,sessionId:session.id,organizationId:session.user.organizationId,
      branchId,action:action,resourceKey,
      tokenHash:stepUpHash(token),proofMethod,
      expiresAt:new Date(now.getTime()+STEP_UP_TTL_MS),
    }});
    await tx.auditEvent.create({data:{
      organizationId:session.user.organizationId,branchId,actorUserId:session.user.id,
      action:"STAFF_STEP_UP_GRANTED",entityType:"StaffStepUpGrant",entityId:grant.id,
      newValues:{action:action,resourceKey,proofMethod,
        expiresAt:grant.expiresAt,sessionId:session.id},
      ipAddress:ctx.ipAddress,userAgent:ctx.userAgent,
    }});
    return {token,expiresAt:grant.expiresAt.toISOString(),
      proofMethod,httpStatus:201} as const;
  },{isolationLevel:"Serializable",timeout:30000}).catch(()=>
    ({error:"step_up_unavailable",httpStatus:503} as const));
  if("error" in result)
    return NextResponse.json({error:result.error},{status:result.httpStatus,headers});
  return NextResponse.json({token:result.token,expiresAt:result.expiresAt,
    proofMethod:result.proofMethod},{status:201,headers});
}
