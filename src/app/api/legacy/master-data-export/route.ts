import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession, permissionSet, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  LegacyMasterExportError, legacyMasterPermissions,
  masterExportManifest, parseMasterExportKind,
  type LegacyMasterExportRow,
} from "@/lib/legacy-master-configuration-export";

export const dynamic="force-dynamic";
const privateHeaders={"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"};

export async function GET(request:NextRequest){
  const session=await getCurrentSession();
  if(!session)return NextResponse.json({error:"unauthorized"},{status:401,headers:privateHeaders});
  const grants=permissionSet(session);
  if(!grants.has("catalog.manage"))
    return NextResponse.json({error:"catalog_manage_required"},{status:403,headers:privateHeaders});
  const kind=parseMasterExportKind(request.nextUrl.searchParams.get("kind"));
  if(!kind)return NextResponse.json({error:"unsupported_master_export_kind"},{status:400,headers:privateHeaders});
  if(!grants.has(legacyMasterPermissions[kind]))
    return NextResponse.json({error:"master_export_permission_required"},{status:403,headers:privateHeaders});
  const organizationId=session.user.organizationId;
  const branchId=session.activeBranchId;
  if(!branchId||!session.user.branchScopes.some(item=>
    item.branchId===branchId && item.branch.status==="ACTIVE" &&
    item.branch.organizationId===organizationId))
    return NextResponse.json({error:"active_branch_scope_required"},{status:403,headers:privateHeaders});

  const context=await requestContext();
  try {
    const result=await prisma.$transaction(async tx=>{
      // Active tenant and actor's live branch scope are checked inside the
      // same read transaction that captures every source row and audit event.
      const org=await tx.$queryRaw<Array<{id:string}>>`
        SELECT id FROM organizations
        WHERE id=${organizationId} AND status='ACTIVE' FOR UPDATE
      `;
      if(org.length!==1)
        return {error:"export_organization_inactive",status:403} as const;
      const [liveBranch,liveScope]=await Promise.all([
        tx.branch.findFirst({where:{id:branchId,organizationId,status:"ACTIVE"},select:{id:true}}),
        tx.userBranchScope.findUnique({where:{userId_branchId:{userId:session.user.id,branchId}},
          select:{userId:true}}),
      ]);
      if(!liveBranch||!liveScope)
        return {error:"export_active_branch_changed",status:403} as const;

      let records:LegacyMasterExportRow[]=[];
      // Only ACTIVE masters are transferable. Inactive/superseded source
      // values are explicitly excluded, never silently reactivated.
      const where={organizationId,status:"ACTIVE" as const};
      const pagination={orderBy:[{code:"asc" as const},{id:"asc" as const}],take:2001};
      if(kind==="REFERRER"){
        const rows=await tx.referrer.findMany({where,...pagination,
          select:{id:true,status:true,code:true,nameEn:true,nameAr:true,type:true,
            phone:true,email:true,licenseNumber:true}});
        records=rows.map(r=>({id:r.id,status:r.status,values:{
          code:r.code,name_en:r.nameEn,name_ar:r.nameAr,type:r.type,
          phone:r.phone,email:r.email,license_number:r.licenseNumber,
        }}));
      }else if(kind==="SOURCE"){
        const rows=await tx.orderSource.findMany({where,...pagination,
          select:{id:true,status:true,code:true,nameEn:true,nameAr:true,category:true}});
        records=rows.map(r=>({id:r.id,status:r.status,values:{
          code:r.code,name_en:r.nameEn,name_ar:r.nameAr,category:r.category,
        }}));
      }else if(kind==="ORGANISM"){
        const rows=await tx.organism.findMany({where,...pagination,
          select:{id:true,status:true,code:true,nameEn:true,nameAr:true,category:true}});
        records=rows.map(r=>({id:r.id,status:r.status,values:{
          code:r.code,name_en:r.nameEn,name_ar:r.nameAr,category:r.category,
        }}));
      }else if(kind==="ANTIBIOTIC"){
        const rows=await tx.antibiotic.findMany({where,...pagination,
          select:{id:true,status:true,code:true,nameEn:true,nameAr:true,drugClass:true}});
        records=rows.map(r=>({id:r.id,status:r.status,values:{
          code:r.code,name_en:r.nameEn,name_ar:r.nameAr,drug_class:r.drugClass,
        }}));
      }else if(kind==="CLIENT"){
        const rows=await tx.client.findMany({where,...pagination,
          select:{id:true,status:true,code:true,nameEn:true,nameAr:true,type:true,
            phone:true,email:true,addressEn:true,addressAr:true,paymentTermsDays:true}});
        records=rows.map(r=>({id:r.id,status:r.status,values:{
          code:r.code,name_en:r.nameEn,name_ar:r.nameAr,type:r.type,
          phone:r.phone,email:r.email,address_en:r.addressEn,address_ar:r.addressAr,
          payment_terms_days:r.paymentTermsDays===null?null:String(r.paymentTermsDays),
        }}));
      }else{
        const rows=await tx.resultCommentTemplate.findMany({where,...pagination,
          select:{id:true,status:true,code:true,nameEn:true,nameAr:true,scope:true,
            textEn:true,textAr:true,test:{select:{code:true,organizationId:true}},
            component:{select:{code:true,test:{select:{code:true,organizationId:true}}}}}});
        records=rows.map(r=>{
          if((r.test&&r.test.organizationId!==organizationId) ||
             (r.component&&r.component.test.organizationId!==organizationId))
            throw new LegacyMasterExportError("clinical_comment_cross_tenant_reference");
          const testCode=r.scope==="COMPONENT"?r.component?.test.code:
            r.scope==="TEST"?r.test?.code:null;
          return {id:r.id,status:r.status,values:{
            code:r.code,name_en:r.nameEn,name_ar:r.nameAr,
            text_en:r.textEn,text_ar:r.textAr,scope:r.scope,
            test_code:testCode||null,
            component_code:r.scope==="COMPONENT"?r.component?.code||null:null,
          }};
        });
      }
      const manifest=masterExportManifest(organizationId,kind,records,new Date().toISOString());
      await tx.auditEvent.create({data:{
        organizationId,branchId,actorUserId:session.user.id,
        action:"LEGACY_MASTER_CONFIGURATION_EXPORTED",
        entityType:"LegacyMasterConfiguration",entityId:organizationId,
        newValues:{
          kind,totalRows:manifest.totalRows,partCount:manifest.partCount,
          integritySha256:manifest.integritySha256,
          exportFormat:manifest.format,scope:manifest.scope,
          includesContacts:kind==="REFERRER"||kind==="CLIENT",
          clinicalTemplateSafety:kind==="COMMENT_TEMPLATE"?"REIMPORT_INACTIVE_ONLY":null,
        },
        ipAddress:context.ipAddress,userAgent:context.userAgent,
      }});
      return {serialized:JSON.stringify(manifest)} as const;
    },{isolationLevel:"RepeatableRead",timeout:45000});
    if("error" in result)
      return NextResponse.json({error:result.error},{status:result.status,headers:privateHeaders});
    return new Response(result.serialized,{status:200,headers:{
      ...privateHeaders,"Content-Type":"application/json; charset=utf-8",
      "Content-Disposition":'attachment; filename="family-lab-master-configuration-'+kind.toLowerCase()+'.json"',
    }});
  }catch(e){
    if(e instanceof LegacyMasterExportError)
      return NextResponse.json({error:e.reason},{status:e.statusCode,headers:privateHeaders});
    return NextResponse.json({error:"controlled_master_export_failed"},{status:409,headers:privateHeaders});
  }
}
