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
  // A plain Prisma snapshot read would leave a TOCTOU gap if the role or
  // permission is revoked before COMMIT. Lock the actual permission chain.
  const actor=await tx.$queryRaw<Array<{id:string}>>`
    SELECT u.id FROM users u
    JOIN user_roles ur ON ur.user_id=u.id
    JOIN roles r ON r.id=ur.role_id
    JOIN role_permissions rp ON rp.role_id=r.id
    JOIN permissions p ON p.id=rp.permission_id
    WHERE u.id=${userId} AND u.organization_id=${organizationId}
    AND u.status='ACTIVE' AND r.organization_id=${organizationId}
    AND r.status='ACTIVE' AND p.code=${permission}
    ORDER BY r.id FOR UPDATE
  `;
  if(!actor.length)deny("forbidden",403);
  const branches=await tx.$queryRaw<Array<{id:string}>>`
    SELECT id FROM branches WHERE organization_id=${organizationId}
    AND status='ACTIVE' ORDER BY id FOR UPDATE
  `;
  if(branchId && !branches.some(b=>b.id===branchId))deny("branch_not_found",404);
  if(!branchId && !branches.length)deny("organization_scope_incomplete",403);
  // Also hold the live grant rows; revocation cannot slip in after the
  // scope comparison and before a clinical INSERT/UPDATE transaction COMMIT.
  const live=await tx.$queryRaw<Array<{branchId:string}>>`
    SELECT s.branch_id AS branchId FROM user_branch_scopes s
    JOIN branches b ON b.id=s.branch_id
    WHERE s.user_id=${userId} AND b.organization_id=${organizationId}
    AND b.status='ACTIVE' ORDER BY s.branch_id FOR UPDATE
  `;
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

/** Recheck and lock optional method, specimen and analyzer master identity.
 * A branch-specific analyzer must belong to that exact branch. Approval never
 * guesses a method, analyte, specimen or vendor interpretation. */
export async function lockActiveReferenceContext(
  tx:Prisma.TransactionClient,input:{
    organizationId:string;branchId:string|null;
    methodId:string|null;analyzerId:string|null;specimenTypeId:string|null;
  },
):Promise<void>{
  const {organizationId,branchId,methodId,analyzerId,specimenTypeId}=input;
  if(methodId){
    const rows=await tx.$queryRaw<Array<{id:string}>>`
      SELECT id FROM methods WHERE id=${methodId}
      AND organization_id=${organizationId} AND status='ACTIVE' FOR UPDATE
    `;
    if(rows.length!==1)deny("method_not_found",404);
  }
  if(specimenTypeId){
    const rows=await tx.$queryRaw<Array<{id:string}>>`
      SELECT id FROM specimen_types WHERE id=${specimenTypeId}
      AND organization_id=${organizationId} AND status='ACTIVE' FOR UPDATE
    `;
    if(rows.length!==1)deny("specimen_type_not_found",404);
  }
  if(analyzerId){
    const rows=await tx.$queryRaw<Array<{id:string;branch_id:string}>>`
      SELECT id,branch_id FROM analyzers WHERE id=${analyzerId}
      AND organization_id=${organizationId} AND status='ACTIVE' FOR UPDATE
    `;
    if(rows.length!==1)deny("analyzer_not_found",404);
    if(branchId && rows[0].branch_id!==branchId)
      deny("analyzer_branch_mismatch",409);
  }
}
