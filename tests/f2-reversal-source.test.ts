import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {canonicalJson,type Json} from "../src/lib/catalog-bundle-attestation.ts";
import {signF2ApplicationJournal} from "../src/lib/catalog-f2-application-journal.ts";
import {recoverF2PreApplyObservationsUnderLock}
  from "../src/lib/catalog-f2-reversal-source.ts";

const id=(n:number)=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const organizationId=id(1),branchId=id(2),batchId=id(3);
const secret="synthetic-f2-reversal-source-HMAC-not-production-32";
const start="2026-12-01T00:00:00.000Z";
const current="2026-11-01T00:00:00.000Z";
const target=id(9),cloneId=id(19),journalId=id(29);
const hash=(v:unknown)=>createHash("sha256")
  .update(canonicalJson(v as Json)).digest("hex");
const before={id:target,effectiveFrom:"2026-01-01T00:00:00.000Z",
  effectiveTo:null,unitPrice:"10.0000",status:"ACTIVE"};
const after={...before,unitPrice:"12.0000"};
const changed={...before,effectiveTo:start,updatedAt:current};
const planDigest="a".repeat(64);
const versionLog=signF2ApplicationJournal({
  batchId,planDigest,effectiveAt:start,newVersionId:cloneId,
  before,after,originalDigest:hash(before),desiredDigest:hash(after),
},secret);
const batchLog=signF2ApplicationJournal({
  organizationId,batchId,planDigest,effectiveAt:start,
  createdVersionIds:[cloneId],journalEventIds:[journalId],
  changedRows:1,unchangedRows:9,
},secret);
const record={rowNumber:1,entityType:"PRICE_LIST_ITEM",
  sourceData:after,normalizedData:{id:target},scopedLiveData:changed};
const input={organizationId,branchId,batchId,secret,rows:[record],
  now:new Date(current)};
const transaction=(opts:{
  batch?:Record<string,unknown>|null;
  version?:Record<string,unknown>|null;versionBranch?:string;
  master?:boolean;
}={})=>({
  auditEvent:{findMany:async(query:any)=>{
    switch(query.where.action){
      case "CATALOG_F2_EFFECTIVE_BATCH_APPLIED":
        return opts.batch===null?[]:[{
          id:id(39),branchId,newValues:opts.batch??batchLog,
        }];
      case "CATALOG_F2_VERSION_CLONED":
        return opts.version===null?[]:[{
          id:journalId,entityType:"PRICE_LIST_ITEM",entityId:target,
          branchId:opts.versionBranch??branchId,
          newValues:opts.version??versionLog,
        }];
      default:throw Error("unexpected audit action");
    }
  }},
  catalogConfigurationRevision:{findMany:async()=>opts.master?[{
    id:id(50),branchId,sourceRowNumber:1,entityType:"PRICE_LIST_ITEM",
    entityId:target,planDigest,
    originalDigest:hash(before),desiredDigest:hash(after),
  }]:[]},
});

test("F2: signed prior native snapshot replaces changed live version, never accepting browser JSON",async()=>{
  const actual=await recoverF2PreApplyObservationsUnderLock(
    transaction() as never,input);
  assert.ok(actual);
  assert.equal(actual.length,1);
  assert.deepEqual(actual[0].scopedLiveData,before);
  assert.equal((input.rows[0].scopedLiveData as typeof changed).effectiveTo,start,
    "the supplied current record remains unchanged");
});

test("F2: reject foreign actor branch, forged HMAC, missing clone and expired cancellation",async()=>{
  assert.equal(await recoverF2PreApplyObservationsUnderLock(
    transaction({versionBranch:id(99)}) as never,input),null);
  assert.equal(await recoverF2PreApplyObservationsUnderLock(
    transaction({batch:{...batchLog,changedRows:200}}) as never,input),null);
  assert.equal(await recoverF2PreApplyObservationsUnderLock(
    transaction({version:{...versionLog,before:{...before,unitPrice:"0.0000"}}})
      as never,input),null);
  assert.equal(await recoverF2PreApplyObservationsUnderLock(
    transaction({version:null}) as never,input),null);
  assert.equal(await recoverF2PreApplyObservationsUnderLock(
    transaction() as never,{...input,now:new Date(start)}),null);
  assert.equal(await recoverF2PreApplyObservationsUnderLock(
    transaction() as never,{...input,organizationId:id(99)}),null);
  assert.equal(await recoverF2PreApplyObservationsUnderLock(
    transaction({batch:null}) as never,input),null);
});

test("F2: master-only plans may reverse without a native clone but require persisted master revisions",async()=>{
  const existing={rowNumber:1,entityType:"TEST",
    normalizedData:{id:target},sourceData:{id:target,nameEn:"NEW"},
    scopedLiveData:{id:target,nameEn:"OLD"}};
  assert.deepEqual(await recoverF2PreApplyObservationsUnderLock(
    transaction({batch:null,master:true}) as never,{
      ...input,rows:[{...existing,entityType:"PRICE_LIST_ITEM"}],
    }),[{...existing,entityType:"PRICE_LIST_ITEM"}]);
  assert.equal(await recoverF2PreApplyObservationsUnderLock(
    transaction({batch:null,master:false}) as never,{
      ...input,rows:[existing],
    }),null);
});

test("F2: reversal API is bodyless, permission-scoped and driven by a full DB re-check",()=>{
  const route=readFileSync(
    "src/app/api/catalog/imports/[id]/configuration-reverse/route.ts","utf8");
  const entry=readFileSync("src/lib/catalog-f2-apply-entry.ts","utf8");
  const migration=readFileSync(
    "prisma/migrations/20261021160500_catalog_f2_reversal_permission/migration.sql","utf8");
  assert.match(route,/export async function POST\(/);
  assert.match(route,/catalog\.configuration\.reverse/);
  assert.match(route,/request\.body!==null/);
  assert.match(route,/f2_reverse_cross_site/);
  assert.match(route,/SELECT id FROM organizations/);
  assert.match(route,/FOR UPDATE/);
  assert.match(route,/isolationLevel:"RepeatableRead"/);
  assert.match(route,/new Date\(\),"REVERSE"/);
  assert.match(entry,/recoverF2PreApplyObservationsUnderLock\(tx,/);
  assert.match(entry,/mode:"APPLY"\|"REVERSE"="APPLY"/);
  assert.match(entry,/catalog\.configuration\.reverse/);
  assert.match(entry,/appliedVersionJournalValidated:true as const/);
  assert.match(entry,/validatePolicyReviewBatchScope\(tx,/);
  assert.match(entry,/loadF2VerifiedSourceReceiptUnderLock\(tx,/);
  assert.match(entry,/verifyCatalogApprovalHistory\(/);
  assert.match(entry,/sourceInstallationVerified:true/);
  assert.match(entry,/masterVersionsReversed:mode==="REVERSE"/);
  assert.doesNotMatch(migration,/role_permissions|SYSTEM_ADMIN/);
  assert.match(migration,/catalog\.configuration\.reverse/);
});
