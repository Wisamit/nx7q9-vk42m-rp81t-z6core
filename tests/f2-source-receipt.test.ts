import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync} from "node:crypto";
import {catalogExportTypes} from "../src/lib/catalog-configuration-export.ts";
import {
  issueF2SourceProvenance,
  type F2TrustedSourceAuthority,
  type F2ObservedStageRow,
} from "../src/lib/catalog-f2-source-provenance.ts";
import {loadF2VerifiedSourceReceiptUnderLock}
  from "../src/lib/catalog-f2-source-receipt.ts";

const id=(n:number)=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const {publicKey,privateKey}=generateKeyPairSync("ed25519");
const trusted:F2TrustedSourceAuthority={
  authorityKeyId:"source-trust-key-2026",
  publicKeyPem:publicKey.export({format:"pem",type:"spki"}).toString(),
  organizationId:id(1),batchId:id(2),sourceChecksum:"b".repeat(64),
  targetInstallationId:id(3),
  keyValidFrom:"2026-01-01T00:00:00.000Z",
  keyValidTo:"2027-01-01T00:00:00.000Z",
};
const branchId=id(4),sourceAuthorUserId=id(5),reviewerUserId=id(6);
const rows:F2ObservedStageRow[]=[...catalogExportTypes].map((entityType,i)=>({
  entityType,sourceData:{id:id(i+30)},normalizedData:{id:id(i+30)},
}));
const document=issueF2SourceProvenance({
  version:1,organizationId:trusted.organizationId,batchId:trusted.batchId,
  sourceChecksum:trusted.sourceChecksum,sourceInstallationId:id(11),
  targetInstallationId:trusted.targetInstallationId,
  issuedAt:"2026-10-20T10:00:00.000Z",
  expiresAt:"2026-11-20T10:00:00.000Z",
  mapping:rows.map(row=>({
    entityType:row.entityType as (typeof catalogExportTypes extends Set<infer T>?T:never),
    sourceId:(row.sourceData as {id:string}).id,
    targetId:(row.normalizedData as {id:string}).id,
  })),
},trusted.authorityKeyId,privateKey);
const codes=["catalog.manage","pricing.manage",
  "catalog.reference_ranges.manage",
  "catalog.configuration.source_provenance.verify"];

type Event={id:string;actorUserId:string|null;branchId:string|null;
  newValues:unknown};
const event:Event={id:id(100),actorUserId:reviewerUserId,branchId,
  newValues:{document}};
const role=(name:string)=>({role:{status:"ACTIVE",organizationId:trusted.organizationId,
  permissions:[{permission:{code:name}}]}});
function txMock(options:{
  events?:Event[]; grants?:string[];branchGranted?:boolean;userActive?:boolean;
}={}){
  const logs:string[]=[];
  const tx={
    auditEvent:{findMany:async()=>{
      logs.push("audit");
      return options.events??[event];
    }},
    user:{findFirst:async()=>{
      logs.push("user");
      if(options.userActive===false)return null;
      return {roles:(options.grants??codes).map(role)};
    }},
    userBranchScope:{findFirst:async()=>{
      logs.push("branch");
      return options.branchGranted===false?null:{branchId};
    }},
  };
  return {tx,logs};
}
const verify=async(mock:ReturnType<typeof txMock>,override:Partial<Parameters<
  typeof loadF2VerifiedSourceReceiptUnderLock>[1]>={})=>
  loadF2VerifiedSourceReceiptUnderLock(mock.tx as never,{
    trusted,branchId,sourceAuthorUserId,
    stagedRows:rows,now:new Date("2026-10-21T11:00:00.000Z"),
    ...override,
  });

test("F2: source receipt requires current independent verifier grants and branch",async()=>{
  const m=txMock();
  const result=await verify(m);
  assert.equal(result?.state,"TRUSTED_INSTALLATION_MAP_VERIFIED");
  assert.equal(result?.reviewerUserId,reviewerUserId);
  assert.equal(result?.branchId,branchId);
  assert.equal(result?.rows,10);
  assert.deepEqual(m.logs,["audit","user","branch"]);
  assert.equal(result?.qualifiedClinicalAndFinancialConsent,false);
  assert.equal(result?.operationalUseAuthorized,false);
});
test("F2: wrong actor, duplicate audit, changed source, missing permission or branch fails closed",async()=>{
  assert.equal(await verify(txMock({events:[]})),null);
  assert.equal(await verify(txMock({events:[event,event]})),null);
  assert.equal(await verify(txMock({events:[{...event,actorUserId:sourceAuthorUserId}]})),null);
  assert.equal(await verify(txMock({events:[{...event,branchId:id(99)}]})),null);
  assert.equal(await verify(txMock({events:[{...event,
    newValues:{document:{...document,sourceChecksum:"f".repeat(64)}}}]})),null);
  assert.equal(await verify(txMock({grants:codes.slice(0,3)})),null);
  assert.equal(await verify(txMock({branchGranted:false})),null);
  assert.equal(await verify(txMock({userActive:false})),null);
  assert.equal(await verify(txMock(),{stagedRows:rows.slice(0,9)}),null);
  assert.equal(await verify(txMock(),{sourceAuthorUserId:reviewerUserId}),null);
  assert.equal(await verify(txMock(),{now:new Date("2026-11-20T10:00:00.000Z")}),null);
});
