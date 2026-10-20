import { NextRequest, NextResponse } from "next/server";
import {
  runIndependentMappingPreflight, type Context,
} from "@/lib/catalog-mapping-inspection-preflight";
import {
  MAPPING_FEEDBACK_HISTORY_LIMIT, createMappingFeedbackDraft,
  validMappingFeedbackDisposition, verifyMappingFeedbackHistory,
  type MappingFeedbackDisposition,
} from "@/lib/catalog-mapping-reviewer-feedback";

export const dynamic="force-dynamic";
const SHA=/^[a-f0-9]{64}$/;
const headers={"Cache-Control":"private, no-store"};
const reject=(error:string,status:number)=>
  NextResponse.json({error},{status,headers});

/**
 * This is an immutable independent correction REQUEST, not a signing route,
 * review approval, source-installation attestation or configuration apply.
 * GET inspection remains in its separate GET-only endpoint.
 */
export async function POST(request:NextRequest,context:Context){
  if((request.headers.get("content-type")||"").split(";")[0].trim().toLowerCase()!=="application/json")
    return reject("mapping_feedback_json_required",415);
  const fetchSite=request.headers.get("sec-fetch-site");
  if(fetchSite==="cross-site")return reject("mapping_feedback_cross_site",403);
  const origin=request.headers.get("origin");
  if(origin && origin!==new URL(request.url).origin)
    return reject("mapping_feedback_origin_mismatch",403);
  const advertised=Number(request.headers.get("content-length")||0);
  if(!Number.isSafeInteger(advertised) || advertised<0 || advertised>512)
    return reject("mapping_feedback_request_too_large",413);
  if(!request.body)return reject("mapping_feedback_missing_body",400);
  const reader=request.body.getReader(),parts:Uint8Array[]=[];
  let size=0;
  for(;;){
    const next=await reader.read();
    if(next.done)break;
    size+=next.value.byteLength;
    if(size>512){
      await reader.cancel("mapping_feedback_request_too_large");
      return reject("mapping_feedback_request_too_large",413);
    }
    parts.push(next.value);
  }
  let raw:unknown;
  try{
    raw=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(Buffer.concat(parts)));
  }catch{return reject("mapping_feedback_invalid_json",400);}
  if(!raw || typeof raw!=="object" || Array.isArray(raw))
    return reject("mapping_feedback_invalid_request",400);
  const body=raw as Record<string,unknown>;
  if(Object.keys(body).sort().join(",") !==
       "authorDraftDigest,disposition,expectedFeedbackRevision" ||
     !Number.isSafeInteger(body.expectedFeedbackRevision) ||
     (body.expectedFeedbackRevision as number)<0 ||
     (body.expectedFeedbackRevision as number)>=MAPPING_FEEDBACK_HISTORY_LIMIT ||
     typeof body.authorDraftDigest!=="string" || !SHA.test(body.authorDraftDigest) ||
     !validMappingFeedbackDisposition(body.disposition))
    return reject("mapping_feedback_invalid_request",400);
  return runIndependentMappingPreflight(request,context,async evidence=>{
    // Reuse exact signed-stage, HMAC author-history, fresh live-token and
    // reviewer scope validation IN THE SAME serialized database transaction.
    const context={
      organizationId:evidence.organizationId,batchId:evidence.batchId,
      branchId:evidence.branchId,rowId:evidence.rowId,
      authorUserId:evidence.authorUserId,sourceChecksum:evidence.sourceChecksum,
      rowNumber:evidence.rowNumber,entityType:evidence.entityType,
    };
    const events=await evidence.tx.auditEvent.findMany({
      where:{
        organizationId:evidence.organizationId,entityType:"CatalogImportRow",
        entityId:evidence.rowId,
        action:"CATALOG_BUNDLE_MAPPING_FEEDBACK_RECORDED",
      },
      orderBy:[{occurredAt:"desc"},{id:"desc"}],
      take:MAPPING_FEEDBACK_HISTORY_LIMIT+1,
      select:{id:true,actorUserId:true,branchId:true,newValues:true},
    });
    const history=verifyMappingFeedbackHistory({
      context,events,secret:evidence.secret,
    });
    if(!history)return {error:"mapping_feedback_history_corrupt",httpStatus:409};
    if(body.authorDraftDigest!==evidence.draft.digest)
      return {error:"mapping_feedback_author_draft_stale",httpStatus:409};
    const latest=history.latest;
    if(body.expectedFeedbackRevision!==history.revision){
      if(latest && latest.revision===(body.expectedFeedbackRevision as number)+1 &&
         latest.reviewerUserId===evidence.reviewerUserId &&
         latest.authorDraftDigest===evidence.draft.digest &&
         latest.observationToken===evidence.currentObservationToken &&
         latest.disposition===body.disposition)
        return {
          status:"INDEPENDENT_MAPPING_FEEDBACK_UNCHANGED",
          feedbackRevision:latest.revision,disposition:latest.disposition,
          reviewOnly:true,sourceInstanceProven:false,mappingApproved:false,
          approved:false,signingEnabled:false,activated:false,liveWrites:false,
        };
      return {error:"mapping_feedback_revision_conflict",httpStatus:409};
    }
    if(latest && latest.reviewerUserId===evidence.reviewerUserId &&
       latest.authorDraftDigest===evidence.draft.digest &&
       latest.observationToken===evidence.currentObservationToken &&
       latest.disposition===body.disposition)
      return {
        status:"INDEPENDENT_MAPPING_FEEDBACK_UNCHANGED",
        feedbackRevision:latest.revision,disposition:latest.disposition,
        reviewOnly:true,sourceInstanceProven:false,mappingApproved:false,
        approved:false,signingEnabled:false,activated:false,liveWrites:false,
      };
    if(history.revision>=MAPPING_FEEDBACK_HISTORY_LIMIT)
      return {error:"mapping_feedback_revision_limit",httpStatus:409};
    const feedback=createMappingFeedbackDraft(context,{
      reviewerUserId:evidence.reviewerUserId,
      revision:history.revision+1,previousDigest:latest?.digest??null,
      authorDraftDigest:evidence.draft.digest,
      observationToken:evidence.currentObservationToken,
      disposition:body.disposition as MappingFeedbackDisposition,
    },evidence.secret);
    await evidence.tx.auditEvent.create({data:{
      organizationId:evidence.organizationId,branchId:evidence.branchId,
      actorUserId:evidence.reviewerUserId,
      entityType:"CatalogImportRow",entityId:evidence.rowId,
      action:"CATALOG_BUNDLE_MAPPING_FEEDBACK_RECORDED",
      newValues:feedback,
    }});
    return {
      status:"INDEPENDENT_MAPPING_FEEDBACK_RECORDED",
      feedbackRevision:feedback.revision,disposition:feedback.disposition,
      reviewOnly:true,sourceInstanceProven:false,mappingApproved:false,
      approved:false,signingEnabled:false,activated:false,liveWrites:false,
    };
  });
}
