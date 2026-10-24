import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { f2ExactUtcInstant } from "./catalog-f2-utc-instant.ts";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA=/^[a-f0-9]{64}$/;
const PURPOSE="family-lab/catalog-f2-effective-dated-approval/v1\n";
const MAX_REAUTH_AGE_MS=5*60_000;
const object=(v:unknown):v is Record<string,unknown> =>
  !!v && typeof v==="object" && !Array.isArray(v);
const shape=(v:Record<string,unknown>,fields:readonly string[])=>
  Object.keys(v).sort().join(",")===[...fields].sort().join(",");
const ms=(v:unknown)=>f2ExactUtcInstant(v) ?? NaN;

export type CatalogApprovalDomain="CLINICAL"|"FINANCIAL";
export type CatalogApprovalContext={
  organizationId:string;batchId:string;branchId:string;authorUserId:string;
  sourceChecksum:string;stagedEvidenceDigest:string;liveSnapshotDigest:string;
  policyDigest:string;effectiveAt:string;
};
export type CatalogApprovalEvidence=CatalogApprovalContext&{
  version:1;revision:1|2;previousDigest:string|null;
  domain:CatalogApprovalDomain;signerUserId:string;
  mfaVerifiedAt:string;signedAt:string;
  decision:"APPROVE"|"REJECT";digest:string;
  seal:{version:1;algorithm:"HMAC-SHA256";signature:string};
  state:"SIGNED_CONFIGURATION_DECISION";liveWrites:false;
};
export type CatalogApprovalAuditEvent={
  id:string;actorUserId:string|null;branchId:string|null;newValues:unknown;
};
const contexts=[
  "organizationId","batchId","branchId","authorUserId",
  "sourceChecksum","stagedEvidenceDigest","liveSnapshotDigest","policyDigest","effectiveAt",
] as const;
const fields=[
  ...contexts,"version","revision","previousDigest","domain","signerUserId",
  "mfaVerifiedAt","signedAt","decision","digest","seal","state","liveWrites",
] as const;
const validContext=(c:CatalogApprovalContext)=>
  [c.organizationId,c.batchId,c.branchId,c.authorUserId].every(x=>UUID.test(x)) &&
  [c.sourceChecksum,c.stagedEvidenceDigest,c.liveSnapshotDigest,c.policyDigest].every(x=>SHA.test(x)) &&
  Number.isFinite(ms(c.effectiveAt));

function payload(c:CatalogApprovalContext,a:{
  revision:1|2;previousDigest:string|null;domain:CatalogApprovalDomain;
  signerUserId:string;mfaVerifiedAt:string;signedAt:string;
  decision:"APPROVE"|"REJECT";
}){
  return [
    ...contexts.map(k=>c[k]),1,a.revision,a.previousDigest,a.domain,
    a.signerUserId,a.mfaVerifiedAt,a.signedAt,a.decision,
  ];
}
/** An authenticated technical decision, not proof of a human's qualification. */
export function createCatalogApprovalEvidence(
  context:CatalogApprovalContext,
  input:{
    revision:1|2;previousDigest:string|null;domain:CatalogApprovalDomain;
    signerUserId:string;mfaVerifiedAt:string;signedAt:string;
    decision:"APPROVE"|"REJECT";
  },
  secret:string,
):CatalogApprovalEvidence{
  const at=ms(input.signedAt),auth=ms(input.mfaVerifiedAt);
  if(!validContext(context) || !UUID.test(input.signerUserId) ||
     input.signerUserId===context.authorUserId ||
     !["CLINICAL","FINANCIAL"].includes(input.domain) ||
     !["APPROVE","REJECT"].includes(input.decision) ||
     (input.revision===1 ? input.previousDigest!==null
      : !SHA.test(input.previousDigest||"")) ||
     !Number.isFinite(at) || !Number.isFinite(auth) ||
     auth>at || at-auth>MAX_REAUTH_AGE_MS ||
     typeof secret!=="string" || Buffer.byteLength(secret,"utf8")<32)
    throw Error("f2_approval_evidence_invalid");
  const body=payload(context,input);
  const digest=createHash("sha256").update(JSON.stringify([
    "FAMILY_LAB_F2_APPROVAL_REVISION_V1",...body,
  ])).digest("hex");
  const signature=createHmac("sha256",secret).update(PURPOSE)
    .update(JSON.stringify([...body,digest,"SIGNED_CONFIGURATION_DECISION",false]))
    .digest("hex");
  return {
    ...context,...input,version:1,digest,
    state:"SIGNED_CONFIGURATION_DECISION",liveWrites:false,
    seal:{version:1,algorithm:"HMAC-SHA256",signature},
  };
}

export function parseCatalogApprovalEvidence(
  value:unknown, context:CatalogApprovalContext,secret:string,
):CatalogApprovalEvidence|null {
  if(!object(value) || !shape(value,fields) || !object(value.seal) ||
     !shape(value.seal,["version","algorithm","signature"]) ||
     value.seal.version!==1 || value.seal.algorithm!=="HMAC-SHA256" ||
     typeof value.seal.signature!=="string" || !SHA.test(value.seal.signature) ||
     value.version!==1 || value.state!=="SIGNED_CONFIGURATION_DECISION" ||
     value.liveWrites!==false || contexts.some(k=>value[k]!==context[k]) ||
     (value.revision!==1 && value.revision!==2) ||
     (value.domain!=="CLINICAL"&&value.domain!=="FINANCIAL") ||
     (value.decision!=="APPROVE"&&value.decision!=="REJECT") ||
     typeof value.signerUserId!=="string" ||
     (value.previousDigest!==null && typeof value.previousDigest!=="string") ||
     typeof value.mfaVerifiedAt!=="string" || typeof value.signedAt!=="string")
    return null;
  try{
    const expected=createCatalogApprovalEvidence(context,{
      revision:value.revision,previousDigest:value.previousDigest,
      domain:value.domain,decision:value.decision,
      signerUserId:value.signerUserId,
      mfaVerifiedAt:value.mfaVerifiedAt,signedAt:value.signedAt,
    },secret);
    return value.digest===expected.digest &&
      timingSafeEqual(
        Buffer.from(value.seal.signature,"hex"),
        Buffer.from(expected.seal.signature,"hex"),
      ) ? expected : null;
  }catch{return null;}
}

export type CatalogApprovalVerification={
  revision:number;clinical:CatalogApprovalEvidence|null;
  financial:CatalogApprovalEvidence|null;
  technicallyApproved:boolean;sourceInstallationVerified:false;
  qualifiedHumanApprovalVerified:false;liveApplyAuthorized:false;
};
/**
 * Read the WHOLE bounded audit history under a tenant lock, independent of
 * MariaDB timestamp/UUID ordering. Both distinct signers must have supplied
 * recent MFA at decision time. Caller must separately validate real roles,
 * original/current grants, source provenance, scope and target drift.
 */
export function verifyCatalogApprovalHistory(input:{
  context:CatalogApprovalContext;events:readonly CatalogApprovalAuditEvent[];
  secret:string;
}):CatalogApprovalVerification|null{
  const {context,events,secret}=input;
  if(!validContext(context)||events.length>2)return null;
  const byRevision=new Map<number,CatalogApprovalEvidence>();
  const ids=new Set<string>();
  for(const event of events){
    if(!UUID.test(event.id) || ids.has(event.id) ||
       event.branchId!==context.branchId ||
       !event.actorUserId || !UUID.test(event.actorUserId))return null;
    ids.add(event.id);
    const approved=parseCatalogApprovalEvidence(event.newValues,context,secret);
    if(!approved || approved.signerUserId!==event.actorUserId ||
       byRevision.has(approved.revision))return null;
    byRevision.set(approved.revision,approved);
  }
  for(let i=1;i<=events.length;i++){
    const record=byRevision.get(i);
    if(!record || record.previousDigest!==(
      i===1 ? null : byRevision.get(i-1)!.digest))return null;
  }
  const first=byRevision.get(1)||null,second=byRevision.get(2)||null;
  if(first && second && (first.signerUserId===second.signerUserId ||
     first.domain===second.domain || ms(first.signedAt)>ms(second.signedAt)))
    return null;
  const clinical=[first,second].find(item=>item?.domain==="CLINICAL")||null;
  const financial=[first,second].find(item=>item?.domain==="FINANCIAL")||null;
  return {revision:events.length,clinical,financial,
    technicallyApproved:!!clinical && !!financial &&
      clinical.decision==="APPROVE" && financial.decision==="APPROVE",
    sourceInstallationVerified:false,qualifiedHumanApprovalVerified:false,
    liveApplyAuthorized:false};
}
