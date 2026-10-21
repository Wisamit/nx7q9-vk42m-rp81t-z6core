import { createHash, createPublicKey, sign, verify, type KeyObject } from "node:crypto";
import { canonicalJson, type Json } from "./catalog-bundle-attestation.ts";
import { catalogExportTypes, type CatalogExportType } from "./catalog-configuration-export.ts";
import { BUNDLE_REVIEW_MAX_ROWS } from "./catalog-bundle-review.ts";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA=/^[a-f0-9]{64}$/;
const KEY_ID=/^[a-zA-Z0-9_-]{8,80}$/;
const B64=/^[a-zA-Z0-9_-]{86}$/;
const PURPOSE="family-lab/source-installation-provenance/v1\n";
const isRecord=(v:unknown):v is Record<string,unknown>=>
  v!==null&&typeof v==="object"&&!Array.isArray(v);
const keys=(v:Record<string,unknown>,fieldNames:readonly string[])=>
  Object.keys(v).sort().join(",")===[...fieldNames].sort().join(",");
const mappingFields=["entityType","sourceId","targetId"] as const;
const payloadFields=[
  "version","organizationId","batchId","sourceChecksum",
  "sourceInstallationId","targetInstallationId",
  "issuedAt","expiresAt","mapping","mappingDigest",
] as const;
const documentFields=[...payloadFields,"signature"] as const;
const signatureFields=["version","algorithm","authorityKeyId","value"] as const;

export type F2SourceMapping={
  entityType:CatalogExportType;sourceId:string;targetId:string;
};
export type F2ProvenancePayload={
  version:1;organizationId:string;batchId:string;sourceChecksum:string;
  sourceInstallationId:string;targetInstallationId:string;
  issuedAt:string;expiresAt:string;
  mapping:readonly F2SourceMapping[];mappingDigest:string;
};
export type F2SignedProvenance=F2ProvenancePayload & {
  signature:{version:1;algorithm:"Ed25519";authorityKeyId:string;value:string};
};
export type F2VerifiedProvenance={
  state:"TRUSTED_INSTALLATION_MAP_VERIFIED";
  sourceInstallationId:string;targetInstallationId:string;
  sourceChecksum:string;mappingDigest:string;
  rows:number;fullTenClassCoverage:true;
  // Proves only possession of a pinned signing key, not employment status,
  // professional judgment, independent authority or operational GO.
  qualifiedClinicalAndFinancialConsent:false;
  operationalUseAuthorized:false;
};
export type F2ObservedStageRow={
  entityType:string;sourceData:unknown;normalizedData:unknown;
};
export type F2TrustedSourceAuthority={
  /** A public key pinned separately from the uploaded bundle and signing HMAC. */
  authorityKeyId:string;publicKeyPem:string;
  organizationId:string;batchId:string;sourceChecksum:string;
  targetInstallationId:string;
  /** Key registry validity is independently controlled by the operator. */
  keyValidFrom:string;keyValidTo:string;
};

const iso=(v:unknown)=>{
  if(typeof v!=="string"||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/.test(v))return NaN;
  const t=Date.parse(v);return Number.isFinite(t)&&new Date(t).toISOString()===v?t:NaN;
};
const digestMap=(mapping:readonly F2SourceMapping[])=>createHash("sha256")
  .update(canonicalJson(mapping as unknown as Json)).digest("hex");
function canonicalDocument(payload:F2ProvenancePayload){
  return Buffer.from(PURPOSE+canonicalJson(payload as unknown as Json),"utf8");
}
/**
 * Separate offline/testing issuer. NEVER call this from a user-triggered
 * Next.js endpoint or use the application HMAC key as provenance authority.
 * The private key belongs to an independent source-owner signing service.
 */
export function issueF2SourceProvenance(
  payload:Omit<F2ProvenancePayload,"mappingDigest">,
  authorityKeyId:string,privateKey:KeyObject,
):F2SignedProvenance{
  if(!KEY_ID.test(authorityKeyId)||privateKey.asymmetricKeyType!=="ed25519"||
     !Array.isArray(payload.mapping)||!payload.mapping.length||
     payload.mapping.length>BUNDLE_REVIEW_MAX_ROWS)
    throw Error("f2_provenance_invalid_issuer_input");
  const data={...payload,mappingDigest:digestMap(payload.mapping)};
  const raw=sign(null,canonicalDocument(data),privateKey);
  return {...data,signature:{
    version:1,algorithm:"Ed25519",authorityKeyId,value:raw.toString("base64url"),
  }};
}

/**
 * Fail closed unless the complete signed mapping is a bijection over the
 * ENTIRE locked, signed staged source. Verify with a separately provisioned
 * Ed25519 authority public key, not a key provided in the imported JSON.
 */
export function verifyF2SourceProvenance(input:{
  document:unknown;trusted:F2TrustedSourceAuthority;
  stagedRows:readonly F2ObservedStageRow[];now:Date;
}):F2VerifiedProvenance|null{
  const {document,stagedRows,now,trusted}=input;
  if(!isRecord(document)||!keys(document,documentFields)||
     document.version!==1||!isRecord(document.signature)||
     !keys(document.signature,signatureFields)||
     document.signature.version!==1||
     document.signature.algorithm!=="Ed25519"||
     document.signature.authorityKeyId!==trusted.authorityKeyId||
     typeof document.signature.value!=="string"||
     !B64.test(document.signature.value)||
     !KEY_ID.test(trusted.authorityKeyId)||
     ![trusted.organizationId,trusted.batchId,trusted.targetInstallationId].every(v=>UUID.test(v))||
     !SHA.test(trusted.sourceChecksum)||
     ![document.organizationId,document.batchId,document.sourceInstallationId,
       document.targetInstallationId].every(v=>typeof v==="string"&&UUID.test(v))||
     document.organizationId!==trusted.organizationId||
     document.batchId!==trusted.batchId||
     document.sourceChecksum!==trusted.sourceChecksum||
     document.targetInstallationId!==trusted.targetInstallationId||
     !SHA.test(String(document.mappingDigest))||
     !Number.isFinite(now.getTime()) ||
     !Number.isFinite(iso(trusted.keyValidFrom))||
     !Number.isFinite(iso(trusted.keyValidTo))||
     !Number.isFinite(iso(document.issuedAt))||
     !Number.isFinite(iso(document.expiresAt))||
     iso(trusted.keyValidFrom)>iso(document.issuedAt)||
     iso(trusted.keyValidTo)<iso(document.expiresAt)||
     iso(document.issuedAt)>now.getTime()||
     iso(document.expiresAt)<=now.getTime()||
     iso(document.issuedAt)>=iso(document.expiresAt)||
     !Array.isArray(document.mapping)||
     document.mapping.length<10||document.mapping.length>BUNDLE_REVIEW_MAX_ROWS||
     document.mapping.length!==stagedRows.length)return null;
  const mapping:F2SourceMapping[]=[];
  const sourceKeys=new Set<string>(),targetKeys=new Set<string>();
  for(const entry of document.mapping){
    if(!isRecord(entry)||!keys(entry,mappingFields)||
       typeof entry.entityType!=="string"||
       !catalogExportTypes.has(entry.entityType as CatalogExportType)||
       typeof entry.sourceId!=="string"||!UUID.test(entry.sourceId)||
       typeof entry.targetId!=="string"||!UUID.test(entry.targetId))return null;
    const src=entry.entityType+":"+entry.sourceId.toLowerCase();
    const target=entry.entityType+":"+entry.targetId.toLowerCase();
    if(sourceKeys.has(src)||targetKeys.has(target))return null;
    sourceKeys.add(src);targetKeys.add(target);
    mapping.push(entry as F2SourceMapping);
  }
  if(new Set(mapping.map(x=>x.entityType)).size!==catalogExportTypes.size||
     digestMap(mapping)!==document.mappingDigest)return null;
  const stageIds=new Set<string>();
  const stageTargets=new Map<string,string>();
  for(const row of stagedRows){
    if(!catalogExportTypes.has(row.entityType as CatalogExportType)||
       !isRecord(row.sourceData)||!isRecord(row.normalizedData)||
       typeof row.sourceData.id!=="string"||!UUID.test(row.sourceData.id)||
       typeof row.normalizedData.id!=="string"||!UUID.test(row.normalizedData.id))
      return null;
    const k=row.entityType+":"+row.sourceData.id.toLowerCase();
    if(stageIds.has(k))return null;
    stageIds.add(k);
    stageTargets.set(k,row.normalizedData.id.toLowerCase());
  }
  if([...stageIds].some(id=>!sourceKeys.has(id))||
     mapping.some(row=>stageTargets.get(row.entityType+":"+row.sourceId.toLowerCase())
       !==row.targetId.toLowerCase()))return null;
  const {signature,...unsigned}=document;
  try{
    const key=createPublicKey(trusted.publicKeyPem);
    if(key.asymmetricKeyType!=="ed25519" ||
       !verify(null,canonicalDocument(unsigned as F2ProvenancePayload),
         key,Buffer.from(signature.value as string,"base64url")))return null;
  }catch{return null;}
  return {
    state:"TRUSTED_INSTALLATION_MAP_VERIFIED",
    sourceInstallationId:document.sourceInstallationId as string,
    targetInstallationId:document.targetInstallationId as string,
    sourceChecksum:document.sourceChecksum as string,
    mappingDigest:document.mappingDigest as string,
    rows:mapping.length,fullTenClassCoverage:true,
    qualifiedClinicalAndFinancialConsent:false,
    operationalUseAuthorized:false,
  };
}
