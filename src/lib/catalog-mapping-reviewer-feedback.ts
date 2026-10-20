import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { bundleTriageClass, type TriageClass } from "./catalog-drift-triage.ts";

export const MAPPING_FEEDBACK_HISTORY_LIMIT = 100;
export type MappingFeedbackDisposition =
  "REQUEST_SOURCE_INSTALLATION_EVIDENCE" | "RETURN_MAPPING_TO_AUTHOR";
export type MappingFeedbackContext = {
  organizationId: string; batchId: string; branchId: string; rowId: string;
  authorUserId: string; sourceChecksum: string; rowNumber: number; entityType: string;
};
export type MappingFeedbackSeal = {
  version: 1; algorithm: "HMAC-SHA256"; signature: string;
};
export type MappingFeedbackDraft = MappingFeedbackContext & {
  reviewerUserId: string; revision: number; previousDigest: string | null;
  authorDraftDigest: string; observationToken: string;
  disposition: MappingFeedbackDisposition; category: TriageClass;
  digest: string; seal: MappingFeedbackSeal;
  state: "INDEPENDENT_MAPPING_FEEDBACK_ONLY";
  reviewOnly: true; sourceInstanceProven: false; mappingApproved: false;
  approved: false; signingEnabled: false; activated: false; liveWrites: false;
};
export type MappingFeedbackHistory = {
  revision: number; latest: MappingFeedbackDraft | null;
};
type Event = {
  id: string; actorUserId: string | null; branchId: string | null;
  newValues: unknown;
};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA=/^[a-f0-9]{64}$/;
const PURPOSE="family-lab/catalog-mapping-independent-feedback/v1\n";
const object=(value:unknown):value is Record<string,unknown> =>
  value !== null && typeof value==="object" && !Array.isArray(value);
const exactKeys=(value:Record<string,unknown>, fields:readonly string[]) =>
  Object.keys(value).sort().join(",") === [...fields].sort().join(",");
const contextFields:readonly (keyof MappingFeedbackContext)[]=[
  "organizationId","batchId","branchId","rowId","authorUserId",
  "sourceChecksum","rowNumber","entityType",
];
const fields=[
  ...contextFields,"reviewerUserId","revision","previousDigest",
  "authorDraftDigest","observationToken","disposition","category",
  "digest","seal","state","reviewOnly","sourceInstanceProven",
  "mappingApproved","approved","signingEnabled","activated","liveWrites",
] as const;

export function validMappingFeedbackDisposition(value:unknown):value is MappingFeedbackDisposition {
  return value==="REQUEST_SOURCE_INSTALLATION_EVIDENCE" ||
    value==="RETURN_MAPPING_TO_AUTHOR";
}
function validContext(value:MappingFeedbackContext):boolean {
  return [value.organizationId,value.batchId,value.branchId,value.rowId,
    value.authorUserId].every(x=>UUID.test(x)) &&
    SHA.test(value.sourceChecksum) &&
    Number.isSafeInteger(value.rowNumber) && value.rowNumber>0 &&
    bundleTriageClass(value.entityType)!==null;
}
export function mappingFeedbackDigest(input: MappingFeedbackContext & {
  reviewerUserId: string; revision: number; previousDigest: string | null;
  authorDraftDigest: string; observationToken: string;
  disposition: MappingFeedbackDisposition;
}):string {
  if (!validContext(input) || !UUID.test(input.reviewerUserId) ||
      input.reviewerUserId===input.authorUserId ||
      !Number.isSafeInteger(input.revision) || input.revision<1 ||
      input.revision>MAPPING_FEEDBACK_HISTORY_LIMIT ||
      (input.previousDigest!==null && !SHA.test(input.previousDigest)) ||
      !SHA.test(input.authorDraftDigest) || !SHA.test(input.observationToken) ||
      !validMappingFeedbackDisposition(input.disposition))
    throw Error("mapping_feedback_invalid_input");
  return createHash("sha256").update(JSON.stringify([
    "FAMILY_LAB_MAPPING_FEEDBACK_V1",
    ...contextFields.map(field=>input[field]),
    input.reviewerUserId,input.revision,input.previousDigest,
    input.authorDraftDigest,input.observationToken,input.disposition,
    bundleTriageClass(input.entityType),
  ])).digest("hex");
}
export function createMappingFeedbackDraft(
  context:MappingFeedbackContext, input:{
    reviewerUserId:string; revision:number; previousDigest:string|null;
    authorDraftDigest:string; observationToken:string;
    disposition:MappingFeedbackDisposition;
  }, secret:string,
):MappingFeedbackDraft {
  if(typeof secret!=="string" || Buffer.byteLength(secret,"utf8")<32)
    throw Error("mapping_feedback_key_unavailable");
  const digest=mappingFeedbackDigest({...context,...input});
  const category=bundleTriageClass(context.entityType);
  if(!category)throw Error("mapping_feedback_unknown_category");
  const unsigned={
    ...context,...input,category,digest,
    state:"INDEPENDENT_MAPPING_FEEDBACK_ONLY" as const,
    reviewOnly:true as const,sourceInstanceProven:false as const,
    mappingApproved:false as const,approved:false as const,
    signingEnabled:false as const,activated:false as const,liveWrites:false as const,
  };
  const signature=createHmac("sha256",secret).update(PURPOSE).update(JSON.stringify([
    ...contextFields.map(field=>unsigned[field]),
    unsigned.reviewerUserId,unsigned.revision,unsigned.previousDigest,
    unsigned.authorDraftDigest,unsigned.observationToken,unsigned.disposition,
    unsigned.category,unsigned.digest,unsigned.state,unsigned.reviewOnly,
    unsigned.sourceInstanceProven,unsigned.mappingApproved,unsigned.approved,
    unsigned.signingEnabled,unsigned.activated,unsigned.liveWrites,
  ])).digest("hex");
  return {...unsigned,seal:{version:1,algorithm:"HMAC-SHA256",signature}};
}
export function parseMappingFeedbackDraft(
  value:unknown, context:MappingFeedbackContext, secret:string,
):MappingFeedbackDraft|null {
  if(!object(value) || !validContext(context) || !exactKeys(value,fields) ||
     contextFields.some(field=>value[field]!==context[field]) ||
     typeof value.reviewerUserId!=="string" ||
     !Number.isSafeInteger(value.revision) ||
     (value.previousDigest!==null && typeof value.previousDigest!=="string") ||
     typeof value.authorDraftDigest!=="string" ||
     typeof value.observationToken!=="string" ||
     !validMappingFeedbackDisposition(value.disposition) ||
     value.category!==bundleTriageClass(context.entityType) ||
     value.state!=="INDEPENDENT_MAPPING_FEEDBACK_ONLY" ||
     value.reviewOnly!==true || value.sourceInstanceProven!==false ||
     value.mappingApproved!==false || value.approved!==false ||
     value.signingEnabled!==false || value.activated!==false ||
     value.liveWrites!==false || !object(value.seal) ||
     !exactKeys(value.seal,["version","algorithm","signature"]) ||
     value.seal.version!==1 || value.seal.algorithm!=="HMAC-SHA256" ||
     typeof value.seal.signature!=="string" ||
     !SHA.test(value.seal.signature))return null;
  try {
    const expected=createMappingFeedbackDraft(context,{
      reviewerUserId:value.reviewerUserId,revision:value.revision as number,
      previousDigest:value.previousDigest as string|null,
      authorDraftDigest:value.authorDraftDigest,
      observationToken:value.observationToken,
      disposition:value.disposition,
    },secret);
    if(expected.digest!==value.digest)return null;
    return timingSafeEqual(
      Buffer.from(expected.seal.signature,"hex"),
      Buffer.from(value.seal.signature,"hex"),
    ) ? expected : null;
  }catch{return null;}
}
/**
 * Every feedback record is authenticated by a separate HMAC domain and by
 * its actual persisted reviewer actor, not by the row author's credential.
 * This history permits corrective discussion ONLY, never clinical/financial
 * approval or portable cross-installation identity mapping.
 */
export function verifyMappingFeedbackHistory(input:{
  context:MappingFeedbackContext; events:readonly Event[]; secret:string;
}):MappingFeedbackHistory|null {
  const {context,events,secret}=input;
  if(!validContext(context) || typeof secret!=="string" ||
     Buffer.byteLength(secret,"utf8")<32 ||
     events.length>MAPPING_FEEDBACK_HISTORY_LIMIT)return null;
  if(!events.length)return {revision:0,latest:null};
  const ids=new Set<string>(),revisions=new Map<number,MappingFeedbackDraft>();
  for(const event of events){
    if(!UUID.test(event.id) || ids.has(event.id) ||
       event.branchId!==context.branchId)return null;
    ids.add(event.id);
    const draft=parseMappingFeedbackDraft(event.newValues,context,secret);
    if(!draft || event.actorUserId!==draft.reviewerUserId ||
       event.actorUserId===context.authorUserId ||
       revisions.has(draft.revision))return null;
    revisions.set(draft.revision,draft);
  }
  for(let revision=1;revision<=events.length;revision++){
    const item=revisions.get(revision);
    if(!item || item.previousDigest !==
       (revision===1 ? null : revisions.get(revision-1)!.digest))return null;
  }
  // Database ORDER BY occurredAt / UUID is NOT a trustworthy sequence:
  // separate serialized appends can share timestamp precision, and UUIDs do
  // not encode the append order. The HMAC-bound revisions and previousDigest
  // links, not physical row order, define the authenticated ledger.
  const latest=revisions.get(events.length)!;
  return {revision:events.length,latest};
}

/**
 * Minimal author-visible correction status. Authenticate the WHOLE persisted
 * reviewer history before calling this helper; stale or unrelated feedback
 * is not a current instruction. Never expose reviewer actor IDs, HMAC or raw
 * clinical/financial values to the author-facing response.
 */
export function currentMappingFeedbackDisposition(
  history: MappingFeedbackHistory, authorDraftDigest: string,
  currentObservationToken: string,
): MappingFeedbackDisposition | null {
  const last=history.latest;
  return last && SHA.test(authorDraftDigest) && SHA.test(currentObservationToken) &&
    last.authorDraftDigest===authorDraftDigest &&
    last.observationToken===currentObservationToken
    ? last.disposition : null;
}
