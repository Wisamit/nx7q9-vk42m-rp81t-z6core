import type { Prisma } from "../../generated/prisma/client.ts";

export type TaxPublicationAuthorityInput = {
  userId: string;
  organizationId: string;
  sessionBranchIds: readonly string[];
  branchId: string | null;
  serviceType: "TEST" | "PACKAGE";
  serviceId: string;
};
export class TaxPublicationAuthorityError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status: number) {
    super(code); this.code=code; this.status=status;
  }
}
function deny(code:string,status:number):never {
  throw new TaxPublicationAuthorityError(code,status);
}

/**
 * Perform this validation only inside the CREATE transaction. It is not
 * an accountant's approval: it ensures CURRENT tenant, role, branch grants
 * and ACTIVE service remain valid while the tax configuration is locked.
 */
export async function lockLiveTaxPublicationAuthority(
  tx: Prisma.TransactionClient,
  input: TaxPublicationAuthorityInput,
): Promise<void> {
  const [tenant] = await tx.$queryRaw<Array<{id:string}>>`
    SELECT id FROM organizations
    WHERE id = ${input.organizationId} AND status = 'ACTIVE' FOR UPDATE`;
  if(!tenant) return deny("tax_authority_forbidden",403);
  const actor=await tx.user.findFirst({
    where: {
      id:input.userId, organizationId:input.organizationId, status:"ACTIVE",
      organization:{status:"ACTIVE"},
      roles:{some:{role:{
        organizationId:input.organizationId,status:"ACTIVE",
        permissions:{some:{permission:{code:"billing.tax.manage"}}},
      }}},
    },select:{id:true},
  });
  if(!actor) return deny("tax_authority_forbidden",403);
  const [branches,grants]=await Promise.all([
    tx.branch.findMany({where:{organizationId:input.organizationId,status:"ACTIVE"},select:{id:true}}),
    tx.userBranchScope.findMany({
      where:{userId:input.userId,
        branch:{organizationId:input.organizationId,status:"ACTIVE"}},
      select:{branchId:true},
    }),
  ]);
  const sessionIds=new Set(input.sessionBranchIds);
  const authorized=new Set(grants.map(x=>x.branchId).filter(id=>sessionIds.has(id)));
  const activeIds=branches.map(x=>x.id);
  if(input.branchId){
    if(!activeIds.includes(input.branchId))return deny("branch_not_found",404);
    if(!authorized.has(input.branchId))return deny("branch_forbidden",403);
  }else if(!activeIds.length||activeIds.some(id=>!authorized.has(id))){
    return deny("organization_scope_incomplete",403);
  }

  // Every impacted active branch must receive its tax version increment
  // atomically. An affected-row mismatch rolls back rather than publishing
  // against an incomplete or changing branch set.
  const affected=await tx.branch.updateMany({
    where:{organizationId:input.organizationId,status:"ACTIVE",
      ...(input.branchId?{id:input.branchId}:{})},
    data:{taxConfigVersion:{increment:1}},
  });
  if(affected.count!==(input.branchId?1:activeIds.length))
    return deny("tax_branch_configuration_changed",409);

  // Static SQL plus bound identifiers; FOR UPDATE serializes a concurrent
  // service retirement. Missing/foreign services roll back branch versions.
  const service=input.serviceType==="TEST"
    ? await tx.$queryRaw<Array<{id:string}>>`
      SELECT id FROM lab_tests
      WHERE id = ${input.serviceId} AND organization_id = ${input.organizationId}
      AND status = 'ACTIVE' FOR UPDATE`
    : await tx.$queryRaw<Array<{id:string}>>`
      SELECT id FROM commercial_packages
      WHERE id = ${input.serviceId} AND organization_id = ${input.organizationId}
      AND status = 'ACTIVE' FOR UPDATE`;
  if(service.length!==1)return deny("tax_service_not_found",404);
}
