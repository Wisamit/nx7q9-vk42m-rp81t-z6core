import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync} from "node:crypto";
import {readFileSync} from "node:fs";
import {
  issueF2SourceProvenance,verifyF2SourceProvenance,
  type F2ObservedStageRow,type F2TrustedSourceAuthority,
} from "../src/lib/catalog-f2-source-provenance.ts";
import {catalogExportTypes} from "../src/lib/catalog-configuration-export.ts";

const id=(n:number)=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const {privateKey,publicKey}=generateKeyPairSync("ed25519");
const attacker=generateKeyPairSync("ed25519");
const sourceRows:F2ObservedStageRow[]=[...catalogExportTypes].map((entityType,i)=>({
  entityType,sourceData:{id:id(i+21)},normalizedData:{id:id(i+21)},
}));
const map=sourceRows.map(row=>({
  entityType:row.entityType as (typeof catalogExportTypes extends Set<infer U>?U:never),
  sourceId:(row.sourceData as {id:string}).id,
  targetId:(row.normalizedData as {id:string}).id,
}));
const trusted:F2TrustedSourceAuthority={
  authorityKeyId:"source-owner-2026",
  publicKeyPem:publicKey.export({type:"spki",format:"pem"}).toString(),
  organizationId:id(1),batchId:id(2),sourceChecksum:"a".repeat(64),
  targetInstallationId:id(4),
  keyValidFrom:"2026-01-01T00:00:00.000Z",
  keyValidTo:"2027-01-01T00:00:00.000Z",
};
const payload={
  version:1 as const,organizationId:trusted.organizationId,
  batchId:trusted.batchId,sourceChecksum:trusted.sourceChecksum,
  sourceInstallationId:id(3),targetInstallationId:trusted.targetInstallationId,
  issuedAt:"2026-10-20T11:00:00.000Z",
  expiresAt:"2026-10-30T11:00:00.000Z",
  mapping:map,
};
const now=new Date("2026-10-21T11:00:00.000Z");
const original=issueF2SourceProvenance(payload,trusted.authorityKeyId,privateKey);
const verify=(document:unknown,stagedRows=sourceRows,authority=trusted,time=now)=>
  verifyF2SourceProvenance({document,stagedRows,trusted:authority,now:time});

test("F2: pinned Ed25519 source authority covers exactly ten staged classes",()=>{
  const result=verify(original);
  assert.ok(result);
  assert.equal(result.rows,10);
  assert.equal(result.fullTenClassCoverage,true);
  assert.equal(result.state,"TRUSTED_INSTALLATION_MAP_VERIFIED");
  assert.equal(result.qualifiedClinicalAndFinancialConsent,false);
  assert.equal(result.operationalUseAuthorized,false);
  assert.equal(JSON.stringify(result).includes("PRIVATE KEY"),false);
  assert.notDeepEqual(result.sourceInstallationId,result.targetInstallationId);
});
test("F2: foreign UUID mapping is explicit, bijective and bound to same stage",()=>{
  const foreign=sourceRows.map((row,index)=>({
    ...row,sourceData:{id:id(index+101)},
  }));
  const mapped=foreign.map(row=>({
    entityType:row.entityType as (typeof catalogExportTypes extends Set<infer U>?U:never),
    sourceId:(row.sourceData as {id:string}).id,
    targetId:(row.normalizedData as {id:string}).id,
  }));
  const signature=issueF2SourceProvenance({...payload,mapping:mapped},
    trusted.authorityKeyId,privateKey);
  assert.ok(verify(signature,foreign));
  assert.equal(verify(signature,sourceRows),null);
  const swap=foreign.map((row,i)=>i===0?{...row,
    normalizedData:{id:id(1111)}}:row);
  assert.equal(verify(signature,swap),null);
  const duplicate=foreign.map((row,i)=>i===1?{...row,sourceData:foreign[0].sourceData}:row);
  assert.equal(verify(signature,duplicate),null);
  const repeated=issueF2SourceProvenance({...payload,mapping:[
    ...mapped.slice(0,9),{...mapped[0]},
  ]},trusted.authorityKeyId,privateKey);
  assert.equal(verify(repeated,foreign),null);
  const merged=issueF2SourceProvenance({...payload,mapping:mapped.map((r,i)=>
    i===1?{...r,entityType:mapped[0].entityType,targetId:mapped[0].targetId}:r,
  )},trusted.authorityKeyId,privateKey);
  assert.equal(verify(merged,foreign),null);
});
test("F2: cryptographic forgery, untrusted keys, revocation and context/time mismatch fail closed",()=>{
  const fake=issueF2SourceProvenance(payload,trusted.authorityKeyId,attacker.privateKey);
  assert.equal(verify(fake),null,"attacker cannot sign with self-provided key");
  assert.equal(verify({...original,signature:{...original.signature,
    value:fake.signature.value}}),null);
  assert.equal(verify({...original,organizationId:id(501)}),null);
  assert.equal(verify({...original,sourceChecksum:"b".repeat(64)}),null);
  assert.equal(verify({...original,sourceInstallationId:id(99)}),null);
  assert.equal(verify({...original,signature:{...original.signature,
    authorityKeyId:"other-source-owner"}}),null);
  assert.equal(verify({...original,unexpected:true}),null);
  assert.equal(verify({...original,signature:{...original.signature,unexpected:true}}),null);
  assert.equal(verify(original,sourceRows,{...trusted,targetInstallationId:id(444)}),null);
  assert.equal(verify(original,sourceRows,{...trusted,batchId:id(445)}),null);
  assert.equal(verify(original,sourceRows,{...trusted,sourceChecksum:"c".repeat(64)}),null);
  assert.equal(verify(original,sourceRows,{...trusted,
    keyValidTo:"2026-10-25T11:00:00.000Z"}),null);
  assert.equal(verify(original,sourceRows,trusted,
    new Date("2026-10-30T11:00:00.000Z")),null);
  assert.equal(verify(original,sourceRows,trusted,
    new Date("2026-10-20T10:59:59.000Z")),null);
  assert.equal(verify(original,sourceRows.slice(0,9)),null);
});
test("F2: original configuration HMAC is never treated as installation provenance",()=>{
  const signed=readFileSync("src/lib/catalog-f2-source-provenance.ts","utf8");
  assert.match(signed,/createPublicKey\(trusted\.publicKeyPem\)/);
  assert.match(signed,/verify\(null,canonicalDocument\(/);
  assert.match(signed,/sourceInstallationId/);
  assert.match(signed,/targetInstallationId/);
  assert.match(signed,/mapping\.length!==stagedRows\.length/);
  assert.doesNotMatch(signed,/APP_ENCRYPTION_KEY|CATALOG_BUNDLE_SIGNING_KEY|process\.env/);
});
