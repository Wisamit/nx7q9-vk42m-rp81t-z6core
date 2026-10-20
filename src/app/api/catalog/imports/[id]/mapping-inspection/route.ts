import { NextRequest } from "next/server";
import {
  runIndependentMappingPreflight, type Context,
} from "@/lib/catalog-mapping-inspection-preflight";
import {
  MAPPING_FEEDBACK_HISTORY_LIMIT, verifyMappingFeedbackHistory,
} from "@/lib/catalog-mapping-reviewer-feedback";

export const dynamic="force-dynamic";

/**
 * Still strictly GET-only. The feedback sequence number makes author-revision
 * CAS available without disclosing the signed token/digest or any source data.
 * A malformed feedback audit history fails closed, even for a simple read.
 */
export async function GET(request:NextRequest,context:Context){
  return runIndependentMappingPreflight(request,context,async evidence=>{
    const historyContext={
      organizationId:evidence.organizationId,batchId:evidence.batchId,
      branchId:evidence.branchId,rowId:evidence.rowId,
      authorUserId:evidence.authorUserId,sourceChecksum:evidence.sourceChecksum,
      rowNumber:evidence.rowNumber,entityType:evidence.entityType,
    };
    const events=await evidence.tx.auditEvent.findMany({
      where:{
        organizationId:evidence.organizationId,entityType:"CatalogImportRow",
        entityId:evidence.rowId,action:"CATALOG_BUNDLE_MAPPING_FEEDBACK_RECORDED",
      },
      orderBy:[{occurredAt:"desc"},{id:"desc"}],
      take:MAPPING_FEEDBACK_HISTORY_LIMIT+1,
      select:{id:true,actorUserId:true,branchId:true,newValues:true},
    });
    const history=verifyMappingFeedbackHistory({
      context:historyContext,events,secret:evidence.secret,
    });
    if(!history)return {error:"mapping_inspection_feedback_history_corrupt",httpStatus:409};
    const freshFeedback=history.latest &&
      history.latest.authorDraftDigest===evidence.draft.digest &&
      history.latest.observationToken===evidence.currentObservationToken;
    return {...evidence.inspection,feedbackRevision:history.revision,
      feedbackDisposition:freshFeedback?history.latest!.disposition:null};
  });
}
