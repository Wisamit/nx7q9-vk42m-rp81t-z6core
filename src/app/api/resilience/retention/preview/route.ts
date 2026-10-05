import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { countRetentionCandidates, protectedRetentionClasses, inAppPurgeClasses, retentionCutoff } from "@/lib/retention";

export async function POST(request:Request){
  const session=await requirePermission("resilience.view");
  const body=await request.json().catch(()=>null) as {dataClass?:unknown}|null;
  const dataClass=typeof body?.dataClass==="string"?body.dataClass:"";
  const policy=await prisma.retentionPolicy.findUnique({
    where:{organizationId_dataClass:{organizationId:session.user.organizationId,dataClass:dataClass as never}},
  }).catch(()=>null);
  if(!policy) return NextResponse.json({error:"retention_policy_not_found"},{status:404});
  const days=policy.action==="ARCHIVE" ? policy.archiveAfterDays : policy.retainDays;
  if(!days) return NextResponse.json({status:"ok",policyId:policy.id,candidateCount:0,executable:false,reason:"threshold_not_configured"});
  const cutoff=retentionCutoff(days);
  const candidateCount=await countRetentionCandidates(prisma,session.user.organizationId,policy.dataClass,cutoff);
  return NextResponse.json({
    status:"ok",policyId:policy.id,dataClass:policy.dataClass,action:policy.action,enabled:policy.enabled,
    cutoff,candidateCount,
    executable:policy.enabled&&policy.action==="PURGE"&&inAppPurgeClasses.has(policy.dataClass),
    protected:protectedRetentionClasses.has(policy.dataClass),
    note:policy.action==="ARCHIVE"?"Archive candidates require export to an approved external archive target before removal; no automatic deletion is performed.":undefined,
  });
}
