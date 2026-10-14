import { createHash, randomBytes } from "node:crypto";
import type { Prisma } from "../../generated/prisma/client";
import { validClinicalRuleProofResource } from "./clinical-rule-step-up.ts";

export const stepUpPermissions = {
  MEDICAL_APPROVAL: "results.medical_validate",
  RESULT_RELEASE: "results.release",
  DISCOUNT_APPROVAL: "billing.discount.approve",
  REFUND_POST: "billing.manage",
  PATIENT_MERGE: "patients.merge",
  RESULT_AMEND: "results.amend",
  CREDIT_NOTE_ISSUE: "billing.manage",
  CLINICAL_RULE_APPROVE: "clinical_rules.approve",
  CLINICAL_RULE_RETIRE: "clinical_rules.approve",
} as const;
export type StaffStepUpAction=keyof typeof stepUpPermissions;
export const STEP_UP_TTL_MS=2*60_000;
export const STEP_UP_FAILURE_LIMIT=5;
export const STEP_UP_WINDOW_MS=15*60_000;

export class StaffStepUpError extends Error {
  readonly code:string;readonly statusCode:number;
  constructor(code:string,statusCode=403){super(code);this.code=code;this.statusCode=statusCode;}
}
export const stepUpHash=(token:string)=>createHash("sha256").update(token).digest("hex");
export const newStepUpToken=()=>randomBytes(32).toString("base64url");
export function validStepUpAction(value:unknown):value is StaffStepUpAction{
  return typeof value==="string"&&Object.hasOwn(stepUpPermissions,value);
}
export function validStepUpResource(action:StaffStepUpAction,value:unknown):value is string{
  const uuid="[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
  if(typeof value!=="string"||value.length>150)return false;
  if(action==="CLINICAL_RULE_APPROVE"||action==="CLINICAL_RULE_RETIRE")
    return validClinicalRuleProofResource(value);
  const refund = `^${uuid}:${uuid}:[0-9]+(?:[.][0-9]{1,4})?:${uuid}$`;
  const merge = `^${uuid}:${uuid}$`;
  const credit = `^${uuid}:[0-9]+(?:[.][0-9]{1,4})?$`;
  const pattern=action==="REFUND_POST" ? refund
    : action==="PATIENT_MERGE" ? merge
    : action==="CREDIT_NOTE_ISSUE" ? credit : `^${uuid}$`;
  return new RegExp(pattern,"i").test(value);
}

export async function consumeStaffStepUp(
  tx:Prisma.TransactionClient,
  args:{token:unknown;action:StaffStepUpAction;resourceKey:string;
    sessionId:string;userId:string;organizationId:string;branchId:string;
    ipAddress:string|null;userAgent:string|null},
) {
  if(typeof args.token!=="string"||!/^[-_A-Za-z0-9]{40,80}$/.test(args.token))
    throw new StaffStepUpError("fresh_staff_reauthentication_required");
  const tokenHash=stepUpHash(args.token);
  const record=await tx.staffStepUpGrant.findUnique({where:{tokenHash},select:{
    id:true,sessionId:true,userId:true,organizationId:true,branchId:true,
    action:true,resourceKey:true,expiresAt:true,consumedAt:true,proofMethod:true,
  }});
  if(!record||record.sessionId!==args.sessionId||record.userId!==args.userId||
     record.organizationId!==args.organizationId||record.branchId!==args.branchId||
     record.action!==args.action||record.resourceKey!==args.resourceKey||
     record.consumedAt||record.expiresAt<=new Date())
    throw new StaffStepUpError("fresh_staff_reauthentication_required");
  const session=await tx.userSession.findFirst({
    where:{id:args.sessionId,userId:args.userId,revokedAt:null,expiresAt:{gt:new Date()}},
    select:{id:true,activeBranchId:true},
  });
  if(!session||session.activeBranchId!==args.branchId)
    throw new StaffStepUpError("step_up_session_or_branch_changed");
  const claim=await tx.staffStepUpGrant.updateMany({
    where:{id:record.id,consumedAt:null,expiresAt:{gt:new Date()},
      sessionId:args.sessionId,organizationId:args.organizationId,
      userId:args.userId,branchId:args.branchId,action:args.action,
      resourceKey:args.resourceKey,tokenHash},
    data:{consumedAt:new Date()},
  });
  if(claim.count!==1)throw new StaffStepUpError("step_up_already_used_or_expired");
  await tx.auditEvent.create({data:{
    organizationId:args.organizationId,branchId:args.branchId,actorUserId:args.userId,
    action:"STAFF_STEP_UP_CONSUMED",entityType:"StaffStepUpGrant",entityId:record.id,
    newValues:{action:args.action,resourceKey:args.resourceKey,
      proofMethod:record.proofMethod,sessionId:args.sessionId},
    ipAddress:args.ipAddress,userAgent:args.userAgent,
  }});
  return {grantId:record.id,proofMethod:record.proofMethod};
}
