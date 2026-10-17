import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { permissionSet, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  LegacyCatalogJsonIntakeError, legacyCatalogSourceNameValid, readLegacyCatalogJson,
} from "@/lib/legacy-catalog-json-intake";
import type { Prisma } from "../../../../../generated/prisma/client";
import { allowedImportEntities, normalizeImportRow, rowValidationStatus, validateImportRow, type ImportInputRow } from "@/lib/catalog-import";

export async function POST(request:Request){
 const session=await requirePermission("catalog.manage"); const ctx=await requestContext();
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
 if(payload.rows.some(row=>(row.entityType==="PRICE_LIST_ITEM"||row.entityType==="PRICE_LIST_PACKAGE_ITEM")) && !permissionSet(session).has("pricing.manage"))return NextResponse.json({error:"pricing_manage_required"},{status:403});
 const normalized=payload.rows.map((row,index)=>{const n=normalizeImportRow(row);const v=validateImportRow(row.entityType,n);return {row,index,n,v,status:rowValidationStatus(v)} as const});
 const checksum=createHash("sha256").update(JSON.stringify(payload.rows)).digest("hex");
 const counts=normalized.reduce((a,r)=>({...a,[r.status]:(a[r.status]||0)+1}),{} as Record<string,number>);
 const batch=await prisma.$transaction(async tx=>{
  const b=await tx.catalogImportBatch.create({data:{organizationId:session.user.organizationId,sourceType:"LEGACY_MDB_EXPORT",sourceName:payload.sourceName as string,sourceChecksum:checksum,status:counts.ERROR?"DRAFT":"VALIDATED",validatedAt:counts.ERROR?null:new Date(),createdByUserId:session.user.id,summary:{total:payload.rows!.length,...counts}}});
  await tx.catalogImportRow.createMany({data:normalized.map(({row,index,n,v,status})=>({batchId:b.id,rowNumber:index+1,entityType:row.entityType,legacyKey:row.legacyKey||null,status,sourceData:row.data,normalizedData:n,validationIssues:v as Prisma.InputJsonArray}))});
  await tx.auditEvent.create({data:{organizationId:session.user.organizationId,branchId:session.activeBranchId,actorUserId:session.user.id,action:"CATALOG_IMPORT_STAGED",entityType:"CatalogImportBatch",entityId:b.id,newValues:{sourceName:payload.sourceName as string,total:payload.rows!.length,...counts},ipAddress:ctx.ipAddress,userAgent:ctx.userAgent}});
  return b;
 });
 return NextResponse.json({id:batch.id,status:batch.status,summary:{total:payload.rows.length,...counts}},{status:201});
}
