import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { permissionSet, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { liveCatalogReviewStagingAuthority } from "@/lib/catalog-review-staging-auth";
import { catalogStageSubmissionKey, lookupCatalogStageReplay } from "@/lib/catalog-stage-idempotency";
import {
  LegacyCatalogJsonIntakeError, legacyCatalogSourceNameValid, readLegacyCatalogJson,
} from "@/lib/legacy-catalog-json-intake";
import type { Prisma } from "../../../../../generated/prisma/client";
import { allowedImportEntities, normalizeImportRow, rowValidationStatus, validateImportRow, type ImportInputRow } from "@/lib/catalog-import";

export async function POST(request:Request){
 const session=await requirePermission("catalog.manage"); const ctx=await requestContext();
 const requestKey=catalogStageSubmissionKey(request.headers.get("x-family-lab-staging-key"));
 if(!requestKey.valid)return NextResponse.json({error:"invalid_catalog_staging_key"},{status:400});
 let raw: unknown;
 try { raw = await readLegacyCatalogJson(request); }
 catch(error) {
  if (error instanceof LegacyCatalogJsonIntakeError)
   return NextResponse.json({error:error.code},{status:error.status});
  throw error;
 }
 const payload=raw as {sourceName?:unknown;rows?:ImportInputRow[]}|null;
 if(!payload||typeof payload!=="object"||!legacyCatalogSourceNameValid(payload.sourceName)||
    !Array.isArray(payload.rows)||payload.rows.length===0||payload.rows.length>20000)
  return NextResponse.json({error:"Invalid import payload."},{status:400});
 if(payload.rows.some(r=>!r||!allowedImportEntities.has(r.entityType)||!r.data||typeof r.data!=="object"||Array.isArray(r.data)))return NextResponse.json({error:"Unsupported import entity."},{status:400});
 // Staging financial configuration requires the financial management permission too.
 if(payload.rows.some(row=>row.entityType.startsWith("PRICE_")) && !permissionSet(session).has("pricing.manage"))return NextResponse.json({error:"pricing_manage_required"},{status:403});
 if(payload.rows.some(row=>row.entityType==="REFERENCE_INTERVAL") && !permissionSet(session).has("catalog.reference_ranges.manage"))return NextResponse.json({error:"reference_ranges_manage_required"},{status:403});
 const normalized=payload.rows.map((row,index)=>{const n=normalizeImportRow(row);const v=validateImportRow(row.entityType,n);return {row,index,n,v,status:rowValidationStatus(v)} as const});
 const checksum=createHash("sha256").update(JSON.stringify(payload.rows)).digest("hex");
 const counts=normalized.reduce((a,r)=>({...a,[r.status]:(a[r.status]||0)+1}),{} as Record<string,number>);
 const result=await prisma.$transaction(async tx=>{
  const org=session.user.organizationId;
  const lock=await tx.$queryRaw<Array<{id:string}>>`
    SELECT id FROM organizations WHERE id=${org} AND status='ACTIVE' FOR UPDATE`;
  if(lock.length!==1)return {error:"catalog_import_organization_inactive",httpStatus:403} as const;
  const live=await liveCatalogReviewStagingAuthority(tx,{
    userId:session.user.id, organizationId:org,
    activeBranchId:session.activeBranchId||"",
    sessionBranchIds:session.user.branchScopes.filter(item=>
      item.branch.organizationId===org && item.branch.status==="ACTIVE"
    ).map(item=>item.branchId),
    sessionDepartmentIds:session.user.departmentScopes.map(item=>item.departmentId),
    needsPricing:payload.rows!.some(row=>row.entityType.startsWith("PRICE_")),
    needsRanges:payload.rows!.some(row=>row.entityType==="REFERENCE_INTERVAL"),
    needsClinicalScope:payload.rows!.some(row=>!["UNIT","CONTAINER"].includes(row.entityType)),
  });
  if(!live)return {error:"catalog_import_staging_authority_revoked",httpStatus:403} as const;
  const stagedStatus=counts.ERROR?"DRAFT":"VALIDATED";
  const replay=await lookupCatalogStageReplay(tx,{
    organizationId:org,authorId:session.user.id,sourceType:"LEGACY_MDB_EXPORT",
    sourceName:payload.sourceName as string,checksum,submissionKey:requestKey.key,
    expectedStatus:stagedStatus,
  });
  if(replay.kind==="conflict")return {error:"catalog_staging_key_reused",httpStatus:409} as const;
  if(replay.kind==="replay")return {batch:{id:replay.id,status:stagedStatus},replayed:true} as const;
  const b=await tx.catalogImportBatch.create({data:{organizationId:session.user.organizationId,sourceType:"LEGACY_MDB_EXPORT",sourceName:payload.sourceName as string,sourceChecksum:checksum,submissionKey:requestKey.key,status:counts.ERROR?"DRAFT":"VALIDATED",validatedAt:counts.ERROR?null:new Date(),createdByUserId:session.user.id,summary:{total:payload.rows!.length,...counts}}});
  await tx.catalogImportRow.createMany({data:normalized.map(({row,index,n,v,status})=>({batchId:b.id,rowNumber:index+1,entityType:row.entityType,legacyKey:row.legacyKey||null,status,sourceData:row.data,normalizedData:n,validationIssues:v as Prisma.InputJsonArray}))});
  await tx.auditEvent.create({data:{organizationId:session.user.organizationId,branchId:session.activeBranchId,actorUserId:session.user.id,action:"CATALOG_IMPORT_STAGED",entityType:"CatalogImportBatch",entityId:b.id,newValues:{sourceName:payload.sourceName as string,total:payload.rows!.length,...counts},ipAddress:ctx.ipAddress,userAgent:ctx.userAgent}});
  return {batch:b,replayed:false};
 },{timeout:30000});
 if("error" in result)return NextResponse.json({error:result.error},{status:result.httpStatus});
 return NextResponse.json({id:result.batch.id,status:result.batch.status,summary:{total:payload.rows.length,...counts},replayed:result.replayed},{status:result.replayed?200:201});
}
