import type { Prisma } from "../../generated/prisma/client.ts";

export type TaxPublicationAuthorityInput = {
  organizationId: string;
  userId: string;
  branchId: string | null;
  serviceType: "TEST" | "PACKAGE";
  serviceId: string;
  /** Session scope is a ceiling; new grants cannot widen this request. */
  sessionBranchIds: readonly string[];
};
export type TaxPublicationAuthorization =
  | {ok:true; affectedBranches:number}
  | {ok:false; error:string; status:number};

const denied=(error:string,status:number):TaxPublicationAuthorization=>
  ({ok:false,error,status});

/**
 * Run inside the transaction that inserts a tax revision and bumps the
 * affected branches' taxConfigVersion. Current tenant, branches, permissions,
 * grants and ACTIVE service must be rechecked before any write. This is NOT
 * medical/financial policy approval or currency conversion.
 */
export async function lockTaxPublicationAuthority(
  tx: Prisma.TransactionClient,
  input: TaxPublicationAuthorityInput,
): Promise<TaxPublicationAuthorization> {
  const {organizationId,userId,branchId,serviceId,serviceType}=input;

  const organization=await tx.$queryRaw<Array<{id:string}>>`
    SELECT id FROM organizations
    WHERE id=${organizationId} AND status='ACTIVE' FOR UPDATE
  `;
  if(organization.length!==1)
    return denied("tax_authority_forbidden",403);

  const actor=await tx.user.findFirst({
    where:{
      id:userId,organizationId,status:"ACTIVE",
      roles:{some:{role:{
        organizationId,status:"ACTIVE",
        permissions:{some:{permission:{code:"billing.tax.manage"}}},
      }}},
    },
    select:{id:true},
  });
  if(!actor)return denied("tax_authority_forbidden",403);

  // An added/re-enabled branch also requires explicit current AND session
  // scope for a tenant-wide tax policy to be published.
  const branches=await tx.$queryRaw<Array<{id:string}>>`
    SELECT id FROM branches WHERE organization_id=${organizationId}
    AND status='ACTIVE' ORDER BY id FOR UPDATE
  `;
  if(branchId && !branches.some(item=>item.id===branchId))
    return denied("branch_not_found",404);
  if(!branchId && !branches.length)
    return denied("organization_scope_incomplete",403);

  const liveGrants=await tx.userBranchScope.findMany({
    where:{userId,branch:{organizationId,status:"ACTIVE"}},
    select:{branchId:true},
  });
  const sessionGrants=new Set(input.sessionBranchIds);
  const authorized=new Set(liveGrants.map(x=>x.branchId)
    .filter(id=>sessionGrants.has(id)));

  if(branchId && !authorized.has(branchId))
    return denied("branch_forbidden",403);
  if(!branchId && branches.some(row=>!authorized.has(row.id)))
    return denied("organization_scope_incomplete",403);

  // Lock service identity so concurrent deactivation cannot race publication.
  const service=serviceType==="TEST"
    ? await tx.$queryRaw<Array<{id:string}>>`
      SELECT id FROM lab_tests WHERE id=${serviceId}
      AND organization_id=${organizationId} AND status='ACTIVE' FOR UPDATE
    `
    : await tx.$queryRaw<Array<{id:string}>>`
      SELECT id FROM commercial_packages WHERE id=${serviceId}
      AND organization_id=${organizationId} AND status='ACTIVE' FOR UPDATE
    `;
  if(service.length!==1)
    return denied("tax_service_not_found",404);

  return {ok:true,affectedBranches:branchId?1:branches.length};
}

export class TaxPublicationGateError extends Error {
  readonly errorCode:string;
  readonly status:number;
  constructor(errorCode:string,status:number){
    super(errorCode);
    this.errorCode=errorCode;
    this.status=status;
  }
}
