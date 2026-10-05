import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";
import type { Prisma } from "../../../../../generated/prisma/client";
import { allowedImportEntities, normalizeImportRow, rowValidationStatus, validateImportRow, type ImportInputRow } from "@/lib/catalog-import";

type ImportEntity="TEST"|"PANEL"|"UNIT"|"CONTAINER"|"REFERENCE_INTERVAL";
type InputRow={entityType:ImportEntity;legacyKey?:string;data:Prisma.InputJsonObject};
const allowed=new Set<ImportEntity>(["TEST","PANEL","UNIT","CONTAINER","REFERENCE_INTERVAL"]);

function text(v:unknown){return typeof v==="string"?v.trim():""}
function normalize(row:InputRow): Prisma.InputJsonObject {
 const d=row.data;
 if(row.entityType==="TEST") return {code:text(d.code||d.Abrev||d.Abre),nameEn:text(d.nameEn||d.Testname||d["test name"]),unit:text(d.unit),assay:text(d.Assay),collection:text(d.Collection),panel:text(d.Panel)};
 if(row.entityType==="UNIT") return {code:text(d.code||d.unit||d.Unit),symbol:text(d.symbol||d.unit||d.Unit)};
 if(row.entityType==="PANEL") return {code:text(d.code||d.profilname).replace(/\s+/g,"_").toUpperCase(),nameEn:text(d.nameEn||d.profilname)};
 if(row.entityType==="CONTAINER") return {code:text(d.code||d.name).replace(/\s+/g,"_").toUpperCase(),nameEn:text(d.nameEn||d.name)};
 return {testName:text(d.testName||d["test name"]),low:d.L??d.low,high:d.H??d.high,unit:text(d["test unit"]||d.unit),sex:text(d.sex).toUpperCase()||"ANY",ageFrom:d.agefrom??null,ageTo:d.ageto??null,ageUnit:text(d.ag).toUpperCase()};
}
function issues(entityType:ImportEntity,n:Prisma.InputJsonObject){
 const out:{severity:"ERROR"|"WARNING";code:string;message:string}[]=[];
 if(entityType==="TEST"&&(!n.code||!n.nameEn))out.push({severity:"ERROR",code:"MISSING_TEST_IDENTITY",message:"Test code/abbreviation and name are required."});
 if(["UNIT","PANEL","CONTAINER"].includes(entityType)&&(!n.code||!n.nameEn&&entityType!=="UNIT"))out.push({severity:"ERROR",code:"MISSING_MASTER_IDENTITY",message:"Code/name could not be normalized."});
 if(entityType==="REFERENCE_INTERVAL"&&!n.testName)out.push({severity:"ERROR",code:"MISSING_RANGE_TEST",message:"Reference interval has no test name."});
 if(entityType==="REFERENCE_INTERVAL"&&!n.unit)out.push({severity:"WARNING",code:"MISSING_RANGE_UNIT",message:"Reference interval has no unit and requires review."});
 return out;
}

export async function POST(request:Request){
 const session=await requirePermission("catalog.manage"); const ctx=await requestContext();
 const payload=await request.json().catch(()=>null) as {sourceName?:string;rows?:ImportInputRow[]}|null;
 if(!payload?.sourceName||!Array.isArray(payload.rows)||payload.rows.length===0||payload.rows.length>20000)return NextResponse.json({error:"Invalid import payload."},{status:400});
 if(payload.rows.some(r=>!r||!allowedImportEntities.has(r.entityType)||typeof r.data!=="object"))return NextResponse.json({error:"Unsupported import entity."},{status:400});
 const normalized=payload.rows.map((row,index)=>{const n=normalizeImportRow(row);const v=validateImportRow(row.entityType,n);return {row,index,n,v,status:rowValidationStatus(v)} as const});
 const checksum=createHash("sha256").update(JSON.stringify(payload.rows)).digest("hex");
 const counts=normalized.reduce((a,r)=>({...a,[r.status]:(a[r.status]||0)+1}),{} as Record<string,number>);
 const batch=await prisma.$transaction(async tx=>{
  const b=await tx.catalogImportBatch.create({data:{organizationId:session.user.organizationId,sourceType:"LEGACY_MDB_EXPORT",sourceName:payload.sourceName!,sourceChecksum:checksum,status:counts.ERROR?"DRAFT":"VALIDATED",validatedAt:counts.ERROR?null:new Date(),createdByUserId:session.user.id,summary:{total:payload.rows!.length,...counts}}});
  await tx.catalogImportRow.createMany({data:normalized.map(({row,index,n,v,status})=>({batchId:b.id,rowNumber:index+1,entityType:row.entityType,legacyKey:row.legacyKey||null,status,sourceData:row.data,normalizedData:n,validationIssues:v as Prisma.InputJsonArray}))});
  await tx.auditEvent.create({data:{organizationId:session.user.organizationId,branchId:session.activeBranchId,actorUserId:session.user.id,action:"CATALOG_IMPORT_STAGED",entityType:"CatalogImportBatch",entityId:b.id,newValues:{sourceName:payload.sourceName,total:payload.rows!.length,...counts},ipAddress:ctx.ipAddress,userAgent:ctx.userAgent}});
  return b;
 });
 return NextResponse.json({id:batch.id,status:batch.status,summary:{total:payload.rows.length,...counts}},{status:201});
}
