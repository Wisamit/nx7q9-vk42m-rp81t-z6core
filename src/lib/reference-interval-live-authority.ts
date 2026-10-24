import type { Prisma } from "../../generated/prisma/client.ts";

export type ReferenceIntervalWriteContext = {
  organizationId:string; userId:string; branchId:string|null;
  permission:"catalog.reference_ranges.manage"|"catalog.reference_ranges.approve";
  sessionBranchIds:readonly string[];
};
export class ReferenceIntervalGateError extends Error {
  readonly errorCode:string; readonly status:number;
  constructor(errorCode:string,status:number){super(errorCode);this.errorCode=errorCode;this.status=status;}
}
const deny=(errorCode:string,status:number):never=>{throw new ReferenceIntervalGateError(errorCode,status);};

/**
 * Serialize all clinical reference interval writes under the SAME active
 * organization lock. A per-row lock cannot prevent phantom overlapping
 * approvals of two different DRAFT IDs. Recheck current actor permission,
 * branch grants and session ceiling before any clinical or audit change.
 * Organization-wide reference rules require every active branch grant.
 * These checks are NOT medical signoff or clinical policy authorization.
 */
export async function lockReferenceIntervalWriteAuthority(
  tx:Prisma.TransactionClient,input:ReferenceIntervalWriteContext,
):Promise<void>{
  const {organizationId,userId,branchId,permission}=input;
  const org=await tx.$queryRaw<Array<{id:string}>>`
    SELECT id FROM organizations WHERE id=${organizationId} AND status='ACTIVE' FOR UPDATE
  `;
  if(org.length!==1)deny("forbidden",403);
  const actor=await tx.user.findFirst({where:{id:userId,organizationId,status:"ACTIVE",
    roles:{some:{role:{organizationId,status:"ACTIVE",
      permissions:{some:{permission:{code:permission}}}
    }}}},select:{id:true}});
  if(!actor)deny("forbidden",403);
  const branches=await tx.$queryRaw<Array<{id:string}>>`
    SELECT id FROM branches WHERE organization_id=${organizationId}
    AND status='ACTIVE' ORDER BY id FOR UPDATE
  `;
  if(branchId && !branches.some(b=>b.id===branchId))deny("branch_not_found",404);
  if(!branchId && !branches.length)deny("organization_scope_incomplete",403);
  const live=await tx.userBranchScope.findMany({
    where:{userId,branch:{organizationId,status:"ACTIVE"}},
    select:{branchId:true},
  });
  const session=new Set(input.sessionBranchIds);
  const authorized=new Set(live.map(x=>x.branchId).filter(id=>session.has(id)));
  if(branchId && !authorized.has(branchId))deny("branch_forbidden",403);
  if(!branchId && branches.some(b=>!authorized.has(b.id)))
    deny("organization_scope_incomplete",403);
}

/** Hold active component and test records in the same transaction. A retired
 * historical interval can still be retired after its parent deactivation. */
export async function lockActiveReferenceComponent(
  tx:Prisma.TransactionClient,organizationId:string,componentId:string,
):Promise<void>{
  const matched=await tx.$queryRaw<Array<{id:string}>>`
    SELECT c.id FROM test_components c JOIN lab_tests t ON t.id=c.test_id
    WHERE c.id=${componentId} AND c.status='ACTIVE'
    AND t.organization_id=${organizationId} AND t.status='ACTIVE'
    FOR UPDATE
  `;
  if(matched.length!==1)deny("component_not_found",404);
}
