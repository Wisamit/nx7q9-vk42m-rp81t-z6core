import {NextRequest,NextResponse} from "next/server";
import {getCurrentSession,permissionSet} from "@/lib/auth";
import {runIndependentMappingPreflight,type Context} from "@/lib/catalog-mapping-inspection-preflight";
import {verifyF2SourceProvenance} from "@/lib/catalog-f2-source-provenance";

export const dynamic="force-dynamic";
const required=["catalog.manage","pricing.manage",
  "catalog.reference_ranges.manage","catalog.configuration.source_provenance.verify"];
const allowed=(s:ReadonlySet<string>)=>required.every(p=>s.has(p));
const deny=(error:string,status:number)=>NextResponse.json({error},{status,
  headers:{"Cache-Control":"private, no-store"}});
const readJson=async(req:NextRequest):Promise<unknown>=>{
  const reader=req.body?.getReader();if(!reader)throw Error("empty");
  const buffers:Uint8Array[]=[];let bytes=0;
  while(true){
    const part=await reader.read();if(part.done)break;
    bytes+=part.value.byteLength;
    if(bytes>1_048_576){await reader.cancel("too_large");throw Error("too_large");}
    buffers.push(part.value);
  }
  return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(Buffer.concat(buffers)));
};

/** Accept only an independently signed 10-class source authority manifest. */
export async function POST(request:NextRequest,context:Context){
  if((request.headers.get("content-type")||"").split(";")[0]!=="application/json")
    return deny("f2_provenance_json_required",415);
  if(request.headers.get("sec-fetch-site")==="cross-site"||
     (request.headers.get("origin") &&
      request.headers.get("origin")!==new URL(request.url).origin))
    return deny("f2_provenance_cross_origin",403);
  const session=await getCurrentSession();
  if(!session)return deny("unauthorized",401);
  if(!allowed(permissionSet(session)))
    return deny("f2_provenance_permission_required",403);
  let document:unknown;
  try{document=await readJson(request);}
  catch{return deny("f2_provenance_invalid_json",400);}
  return runIndependentMappingPreflight(request,context,async evidence=>{
    const active=await evidence.tx.user.findFirst({
      where:{id:session.user.id,organizationId:evidence.organizationId,status:"ACTIVE"},
      select:{roles:{include:{role:{include:{permissions:{include:{permission:true}}}}}}},
    });
    const permissions=new Set(active?.roles.filter(r=>r.role.status==="ACTIVE"&&
      r.role.organizationId===evidence.organizationId).flatMap(r=>
      r.role.permissions.map(p=>p.permission.code))||[]);
    if(!allowed(permissions)||session.user.id!==evidence.reviewerUserId)
      return {error:"f2_provenance_current_scope_denied",httpStatus:403};
    const authorityKeyId=process.env.F2_SOURCE_AUTHORITY_KEY_ID;
    const publicKeyPem=process.env.F2_SOURCE_AUTHORITY_PUBLIC_KEY_PEM;
    const targetInstallationId=process.env.F2_TARGET_INSTALLATION_ID;
    const keyValidFrom=process.env.F2_SOURCE_AUTHORITY_VALID_FROM;
    const keyValidTo=process.env.F2_SOURCE_AUTHORITY_VALID_TO;
    if(!authorityKeyId||!publicKeyPem||!targetInstallationId||
       !keyValidFrom||!keyValidTo)
      return {error:"f2_provenance_authority_unconfigured",httpStatus:503};
    const allRows=await evidence.tx.catalogImportRow.findMany({
      where:{batchId:evidence.batchId},orderBy:{rowNumber:"asc"},
      take:5001,select:{entityType:true,sourceData:true,normalizedData:true},
    });
    const checked=verifyF2SourceProvenance({
      document,now:new Date(),stagedRows:allRows,
      trusted:{authorityKeyId,publicKeyPem,targetInstallationId,
        keyValidFrom,keyValidTo,organizationId:evidence.organizationId,
        batchId:evidence.batchId,sourceChecksum:evidence.sourceChecksum},
    });
    if(!checked)return {error:"f2_provenance_signed_mapping_invalid",httpStatus:409};
    const prior=await evidence.tx.auditEvent.findMany({
      where:{organizationId:evidence.organizationId,entityType:"CatalogImportBatch",
        entityId:evidence.batchId,
        action:"CATALOG_F2_SOURCE_PROVENANCE_RECORDED"},
      take:2,select:{newValues:true},
    });
    if(prior.length>1)return {error:"f2_provenance_duplicate_audit",httpStatus:409};
    if(prior.length){
      const old=prior[0].newValues;
      if(!old||typeof old!=="object"||Array.isArray(old)||
         !("document" in old)||JSON.stringify(old.document)!==JSON.stringify(document))
        return {error:"f2_provenance_conflicting_attestation",httpStatus:409};
      return {status:"ALREADY_RECORDED",rows:checked.rows,
        clinicalApproval:false,financialApproval:false,masterWrites:false};
    }
    await evidence.tx.auditEvent.create({data:{
      organizationId:evidence.organizationId,branchId:evidence.branchId,
      actorUserId:evidence.reviewerUserId,entityType:"CatalogImportBatch",
      entityId:evidence.batchId,action:"CATALOG_F2_SOURCE_PROVENANCE_RECORDED",
      newValues:{document} as never,
    }});
    return {status:"SOURCE_PROVENANCE_RECORDED",rows:checked.rows,
      clinicalApproval:false,financialApproval:false,masterWrites:false};
  },false,true);
}
