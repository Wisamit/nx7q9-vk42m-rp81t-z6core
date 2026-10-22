import type {Prisma} from "../../generated/prisma/client";
import {
  verifyF2SourceProvenance,type F2ObservedStageRow,
  type F2TrustedSourceAuthority,type F2VerifiedProvenance,
} from "./catalog-f2-source-provenance.ts";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const obj=(v:unknown):v is Record<string,unknown> =>
  v!==null&&typeof v==="object"&&!Array.isArray(v);

export type F2AuthenticatedSourceReceipt=F2VerifiedProvenance&{
  reviewerUserId:string;
  branchId:string;
};
/**
 * Load one independent source-owner attestation from the SAME tenant-locked
 * transaction used to authorize a future apply/reversal. Never trust the
 * uploaded bundle's embedded public key or infer provenance from equal IDs.
 * Re-check reviewer identity, role, branch and signed manifest on each call.
 */
export async function loadF2VerifiedSourceReceiptUnderLock(
  tx:Prisma.TransactionClient,
  input:{
    trusted:F2TrustedSourceAuthority;branchId:string;
    sourceAuthorUserId:string;stagedRows:readonly F2ObservedStageRow[];
    now:Date;
  },
):Promise<F2AuthenticatedSourceReceipt|null>{
  const {trusted,branchId,sourceAuthorUserId,stagedRows,now}=input;
  if(!UUID.test(branchId)||!UUID.test(sourceAuthorUserId))return null;
  const records=await tx.auditEvent.findMany({
    where:{organizationId:trusted.organizationId,
      entityType:"CatalogImportBatch",entityId:trusted.batchId,
      action:"CATALOG_F2_SOURCE_PROVENANCE_RECORDED"},
    take:2,
    select:{id:true,actorUserId:true,branchId:true,newValues:true},
  });
  if(records.length!==1)return null;
  const entry=records[0];
  if(!entry.actorUserId||!UUID.test(entry.actorUserId)||
     entry.actorUserId===sourceAuthorUserId ||
     entry.branchId!==branchId||!obj(entry.newValues)||
     !obj(entry.newValues.document))return null;
  const signed=verifyF2SourceProvenance({
    document:entry.newValues.document,trusted,stagedRows,now,
  });
  if(!signed)return null;
  const reviewer=await tx.user.findFirst({
    where:{id:entry.actorUserId,organizationId:trusted.organizationId,
      status:"ACTIVE"},
    select:{roles:{include:{role:{include:{
      permissions:{include:{permission:true}},
    }}}}},
  });
  if(!reviewer)return null;
  const permissionSet=new Set(reviewer.roles.filter(role=>
    role.role.status==="ACTIVE"&&
    role.role.organizationId===trusted.organizationId,
  ).flatMap(role=>role.role.permissions.map(grant=>grant.permission.code)));
  if(!["catalog.manage","pricing.manage",
    "catalog.reference_ranges.manage",
    "catalog.configuration.source_provenance.verify"].every(p=>permissionSet.has(p)))
    return null;
  const branchGrant=await tx.userBranchScope.findFirst({
    where:{userId:entry.actorUserId,branchId,
      branch:{organizationId:trusted.organizationId,status:"ACTIVE"}},
    select:{branchId:true},
  });
  if(!branchGrant)return null;
  return {...signed,reviewerUserId:entry.actorUserId,branchId};
}
