import type {Prisma} from "../../generated/prisma/client";

/**
 * Rule.branchId=null means rule evaluation can apply at more than one branch.
 * Never let a branch-limited approver widen clinical policy scope in silence.
 * Verify both current DB grants and the grants present in the authenticated
 * session so added rights require a fresh session to be recognized.
 */
export async function assessClinicalGovernanceScope(
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    userId: string;
    activeBranchId: string;
    authorizationBranchId: string | null;
    sessionBranchIds: readonly string[];
    sessionDepartmentIds: readonly string[];
  },
): Promise<
  | {ok:true; organizationWide:boolean; activeBranchCount:number; activeDepartmentCount:number}
  | {ok:false; error:"clinical_rule_branch_scope_revoked" |
      "clinical_rule_branch_scope_mismatch" |
      "clinical_rule_organization_wide_branch_coverage_required" |
      "clinical_rule_organization_wide_department_coverage_required"}
> {
  const originalBranches=new Set(input.sessionBranchIds);
  const [activeBranches, currentBranchGrants]=await Promise.all([
    tx.branch.findMany({
      where:{organizationId:input.organizationId,status:"ACTIVE"},
      select:{id:true},
    }),
    tx.userBranchScope.findMany({
      where:{userId:input.userId,branch:{
        organizationId:input.organizationId,status:"ACTIVE",
      }},
      select:{branchId:true},
    }),
  ]);
  const grants=new Set(currentBranchGrants
    .filter(grant=>originalBranches.has(grant.branchId)).map(grant=>grant.branchId));
  if(!grants.has(input.activeBranchId) ||
      !activeBranches.some(branch=>branch.id===input.activeBranchId))
    return {ok:false,error:"clinical_rule_branch_scope_revoked"};
  if(input.authorizationBranchId!==null){
    if(input.authorizationBranchId!==input.activeBranchId ||
        !grants.has(input.authorizationBranchId))
      return {ok:false,error:"clinical_rule_branch_scope_mismatch"};
    return {ok:true,organizationWide:false,
      activeBranchCount:1,activeDepartmentCount:0};
  }

  // A null rule branch can affect every active branch, including ones whose
  // scope is unrelated to the current dashboard branch.
  if(!activeBranches.every(branch=>grants.has(branch.id)))
    return {ok:false,error:"clinical_rule_organization_wide_branch_coverage_required"};

  const [departments,currentDepartmentGrants]=await Promise.all([
    tx.department.findMany({
      where:{organizationId:input.organizationId,status:"ACTIVE",
        OR:[{branchId:null},{branch:{status:"ACTIVE",
          organizationId:input.organizationId}}],
      },
      select:{id:true},
    }),
    tx.userDepartmentScope.findMany({
      where:{userId:input.userId,
        department:{organizationId:input.organizationId,status:"ACTIVE"}},
      select:{departmentId:true},
    }),
  ]);
  // In the existing LIS policy, zero department grants means unrestricted
  // department scope. If either source has scoped grants, all departments
  // must be covered in both current DB and authenticated session.
  const originalDepartments=new Set(input.sessionDepartmentIds);
  if(originalDepartments.size>0||currentDepartmentGrants.length>0){
    const authorized=new Set(currentDepartmentGrants
      .filter(grant=>originalDepartments.has(grant.departmentId))
      .map(grant=>grant.departmentId));
    if(!departments.every(department=>authorized.has(department.id)))
      return {ok:false,error:"clinical_rule_organization_wide_department_coverage_required"};
  }
  return {ok:true,organizationWide:true,
    activeBranchCount:activeBranches.length,activeDepartmentCount:departments.length};
}
