import { randomUUID } from "node:crypto";
import type { Prisma } from "../../generated/prisma/client";
import type { F2ApplyPlan } from "./catalog-f2-apply-plan.ts";
import {
  signF2ApplicationJournal,verifyF2ApplicationJournal,
} from "./catalog-f2-application-journal.ts";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MONEY=/^(?:0|[1-9][0-9]{0,13})(?:\.[0-9]{1,4})?$/;
const DECIMAL=(whole:number,fraction:number)=>new RegExp(
  "^-?(?:0|[1-9][0-9]{0,"+(whole-1)+"})(?:\\.[0-9]{1,"+fraction+"})?$");
const decimal=(v:unknown,w:number,f:number)=>v===null ||
  (typeof v==="string"&&DECIMAL(w,f).test(v));
const obj=(v:unknown):v is Record<string,unknown> =>
  v!==null&&typeof v==="object"&&!Array.isArray(v);
const date=(v:unknown)=>typeof v==="string"&&Number.isFinite(Date.parse(v))?
  new Date(v):null;

export type F2EffectiveApplyResult={
  state:"EFFECTIVE_VERSIONS_APPLIED"|"EFFECTIVE_VERSIONS_ALREADY_APPLIED";
  batchId:string;createdVersionIds:readonly string[];
  journalEventIds:readonly string[];
  changedRows:number;unchangedRows:number;
};
export type F2EffectiveApplyAuthority={
  organizationId:string;branchId:string;batchId:string;
  actorUserId:string;clinicalSignerId:string;financialSignerId:string;
  journalSigningSecret:string;
  sourceInstallationVerified:true;qualifiedDomainSignersVerified:true;
  currentPermissionsAndBranchScopeVerified:true;
  signedStageAndLiveSnapshotVerified:true;
};

/**
 * Transaction-core for creating *new*, effective-dated clinical and tariff
 * records while retaining historical versions and order/result FK history.
 * Other operations are intentionally rejected rather than misrepresented as
 * complete. CALLER MUST own a tenant FOR UPDATE lock, a verified stage/plan,
 * original+current permissions, signing history and branch/department scope.
 *
 * Never permit this helper to be wired directly to an unauthenticated route.
 * The paired application journal is written transactionally with each clone.
 */
export async function applyF2EffectiveVersionsUnderLock(
  tx:Prisma.TransactionClient,plan:F2ApplyPlan,
  authority:F2EffectiveApplyAuthority,now:Date,
):Promise<F2EffectiveApplyResult>{
  if(plan.format!=="F2_TEN_CLASS_EXECUTABLE_PLAN_V1"||
     !UUID.test(authority.organizationId)||!UUID.test(authority.branchId)||
     !UUID.test(authority.batchId)||!UUID.test(authority.actorUserId)||
     !UUID.test(authority.clinicalSignerId)||!UUID.test(authority.financialSignerId)||
     new Set([authority.actorUserId,authority.clinicalSignerId,
       authority.financialSignerId]).size!==3 ||
     !authority.journalSigningSecret ||
     Buffer.byteLength(authority.journalSigningSecret,"utf8")<32 ||
     !authority.sourceInstallationVerified ||
     !authority.qualifiedDomainSignersVerified ||
     !authority.currentPermissionsAndBranchScopeVerified ||
     !authority.signedStageAndLiveSnapshotVerified ||
     !Number.isFinite(now.getTime()))
    throw Error("f2_apply_unauthorized");
  const effectiveAt=new Date(plan.effectiveAt);
  if(!Number.isFinite(effectiveAt.getTime())||
     effectiveAt.getTime()<=now.getTime())
    throw Error("f2_apply_requires_future_effective_date");
  const changes=plan.rows.filter(row=>row.operation!=="UNCHANGED");
  if(changes.some(row=>row.operation!=="EFFECTIVE_DATED_NEW_VERSION"))
    throw Error("f2_apply_other_class_support_pending");
  const existing=await tx.auditEvent.findMany({
    where:{organizationId:authority.organizationId,
      entityType:"CatalogImportBatch",entityId:authority.batchId,
      action:"CATALOG_F2_EFFECTIVE_BATCH_APPLIED"},
    take:2,select:{id:true,newValues:true},
  });
  if(existing.length>1)throw Error("f2_apply_journal_corrupt");
  if(existing.length){
    const saved=verifyF2ApplicationJournal(
      existing[0].newValues,authority.journalSigningSecret);
    if(!saved||saved.planDigest!==plan.planDigest ||
       saved.organizationId!==authority.organizationId ||
       !Array.isArray(saved.createdVersionIds) ||
       !Array.isArray(saved.journalEventIds))
      throw Error("f2_apply_batch_already_changed");
    return {
      state:"EFFECTIVE_VERSIONS_ALREADY_APPLIED",
      batchId:authority.batchId,
      createdVersionIds:saved.createdVersionIds as string[],
      journalEventIds:saved.journalEventIds as string[],
      changedRows:changes.length,unchangedRows:plan.unchangedRows,
    };
  }
  const versions:string[]=[],audits:string[]=[];
  for(const row of changes){
    if(!obj(row.originalSnapshot)||!obj(row.desiredSnapshot)||
       !UUID.test(row.targetId)||
       row.originalSnapshot.id!==row.targetId ||
       row.desiredSnapshot.id!==row.targetId ||
       row.originalSnapshot.status!=="ACTIVE"||
       row.desiredSnapshot.status!=="ACTIVE"||
       row.originalSnapshot.effectiveTo!==null||
       row.desiredSnapshot.effectiveTo!==null)
      throw Error("f2_apply_invalid_source_version");
    const start=date(row.originalSnapshot.effectiveFrom);
    if(!start||start.getTime()>=effectiveAt.getTime())
      throw Error("f2_apply_old_version_period_conflict");
    const newId=randomUUID();
    if(row.entityType==="PRICE_LIST_ITEM"||
       row.entityType==="PRICE_LIST_PACKAGE_ITEM"){
      if(row.changedFields.join(",")!=="unitPrice" ||
         !MONEY.test(String(row.desiredSnapshot.unitPrice)) ||
         !UUID.test(String(row.desiredSnapshot.priceListId)))
        throw Error("f2_apply_price_invalid");
      const unitPrice=row.desiredSnapshot.unitPrice as string;
      if(row.entityType==="PRICE_LIST_ITEM"){
        const testId=row.originalSnapshot.testId;
        if(typeof testId!=="string"||!UUID.test(testId))
          throw Error("f2_apply_price_test_invalid");
        const sibling=await tx.priceListItem.findMany({
          where:{priceListId:row.originalSnapshot.priceListId as string,testId,
            status:"ACTIVE",effectiveTo:null},
          select:{id:true},take:2,
        });
        if(sibling.length!==1||sibling[0].id!==row.targetId)
          throw Error("f2_apply_price_overlap");
        const claim=await tx.priceListItem.updateMany({
          where:{id:row.targetId,priceListId:row.originalSnapshot.priceListId as string,
            testId,status:"ACTIVE",effectiveTo:null,
            effectiveFrom:start},
          data:{effectiveTo:effectiveAt},
        });
        if(claim.count!==1)throw Error("f2_apply_price_conflict");
        await tx.priceListItem.create({data:{
          id:newId,priceListId:row.originalSnapshot.priceListId as string,
          testId,unitPrice,effectiveFrom:effectiveAt,status:"ACTIVE",
        }});
      }else{
        const packageId=row.originalSnapshot.packageId;
        if(typeof packageId!=="string"||!UUID.test(packageId))
          throw Error("f2_apply_package_invalid");
        const sibling=await tx.priceListPackageItem.findMany({
          where:{priceListId:row.originalSnapshot.priceListId as string,
            packageId,status:"ACTIVE",effectiveTo:null},
          select:{id:true},take:2,
        });
        if(sibling.length!==1||sibling[0].id!==row.targetId)
          throw Error("f2_apply_package_overlap");
        const claim=await tx.priceListPackageItem.updateMany({
          where:{id:row.targetId,priceListId:row.originalSnapshot.priceListId as string,
            packageId,status:"ACTIVE",effectiveTo:null,
            effectiveFrom:start},
          data:{effectiveTo:effectiveAt},
        });
        if(claim.count!==1)throw Error("f2_apply_package_conflict");
        await tx.priceListPackageItem.create({data:{
          id:newId,priceListId:row.originalSnapshot.priceListId as string,
          packageId,unitPrice,effectiveFrom:effectiveAt,status:"ACTIVE",
        }});
      }
    }else if(row.entityType==="REFERENCE_INTERVAL"){
      const prior=row.originalSnapshot,desired=row.desiredSnapshot;
      if(prior.approvalStatus!=="APPROVED"||
         desired.approvalStatus!=="APPROVED")
        throw Error("f2_apply_range_not_approved");
      const monetaryFields=["ageFrom","ageTo","gestationalAgeFromWeeks",
        "gestationalAgeToWeeks","lowValue","highValue","criticalLow","criticalHigh"] as const;
      for(const field of monetaryFields){
        const whole=field.startsWith("gestational")?4:field.startsWith("age")?7:12;
        const frac=field.startsWith("gestational")?2:field.startsWith("age")?3:6;
        if(!decimal(desired[field],whole,frac))
          throw Error("f2_apply_range_decimal_invalid");
      }
      const componentId=prior.componentId;
      if(typeof componentId!=="string"||!UUID.test(componentId))
        throw Error("f2_apply_range_identity");
      // A second concurrently configured open, approved interval for the
      // identical population/method scope would make the newly activated
      // critical range ambiguous. Reject rather than choose arbitrary one.
      const openScope=await tx.referenceInterval.findMany({
        where:{
          componentId,branchId:prior.branchId as string|null,
          methodId:prior.methodId as string|null,
          analyzerId:prior.analyzerId as string|null,
          specimenTypeId:prior.specimenTypeId as string|null,
          sex:prior.sex as never,
          ageFrom:prior.ageFrom as string|null,
          ageTo:prior.ageTo as string|null,
          ageUnit:prior.ageUnit as never,
          pregnancyStatus:prior.pregnancyStatus as never,
          gestationalAgeFromWeeks:prior.gestationalAgeFromWeeks as string|null,
          gestationalAgeToWeeks:prior.gestationalAgeToWeeks as string|null,
          populationCode:prior.populationCode as string|null,
          status:"ACTIVE",approvalStatus:"APPROVED",effectiveTo:null,
        },select:{id:true},take:2,
      });
      if(openScope.length!==1||openScope[0].id!==row.targetId)
        throw Error("f2_apply_range_population_overlap");
      const claim=await tx.referenceInterval.updateMany({
        where:{id:row.targetId,componentId,
          status:"ACTIVE",approvalStatus:"APPROVED",effectiveTo:null,
          effectiveFrom:start},
        data:{effectiveTo:effectiveAt},
      });
      if(claim.count!==1)throw Error("f2_apply_range_conflict");
      await tx.referenceInterval.create({data:{
        id:newId,componentId,branchId:prior.branchId as string|null,
        methodId:prior.methodId as string|null,
        analyzerId:prior.analyzerId as string|null,
        specimenTypeId:prior.specimenTypeId as string|null,
        sex:desired.sex as never,
        ageFrom:desired.ageFrom as string|null,ageTo:desired.ageTo as string|null,
        ageUnit:desired.ageUnit as never,
        pregnancyStatus:desired.pregnancyStatus as never,
        gestationalAgeFromWeeks:desired.gestationalAgeFromWeeks as string|null,
        gestationalAgeToWeeks:desired.gestationalAgeToWeeks as string|null,
        populationCode:desired.populationCode as string|null,
        lowValue:desired.lowValue as string|null,
        highValue:desired.highValue as string|null,
        normalTextEn:desired.normalTextEn as string|null,
        normalTextAr:desired.normalTextAr as string|null,
        criticalLow:desired.criticalLow as string|null,
        criticalHigh:desired.criticalHigh as string|null,
        source:desired.source as string|null,
        notes:desired.notes as string|null,
        effectiveFrom:effectiveAt,
        approvalStatus:"APPROVED",status:"ACTIVE",
        createdByUserId:authority.actorUserId,
        approvedByUserId:authority.clinicalSignerId,
        approvedAt:now,
      }});
    }else throw Error("f2_apply_unrecognized_version_type");
    versions.push(newId);
    const audit=await tx.auditEvent.create({data:{
      organizationId:authority.organizationId,branchId:authority.branchId,
      actorUserId:authority.actorUserId,action:"CATALOG_F2_VERSION_CLONED",
      entityType:row.entityType,entityId:row.targetId,
      newValues:signF2ApplicationJournal({
        batchId:authority.batchId,planDigest:plan.planDigest,
        effectiveAt:plan.effectiveAt,newVersionId:newId,
        before:row.originalSnapshot,
        after:row.desiredSnapshot,
        originalDigest:row.originalDigest,desiredDigest:row.desiredDigest,
      },authority.journalSigningSecret) as Prisma.InputJsonObject,
    }});
    audits.push(audit.id);
  }
  await tx.auditEvent.create({data:{
    organizationId:authority.organizationId,branchId:authority.branchId,
    actorUserId:authority.actorUserId,
    entityType:"CatalogImportBatch",entityId:authority.batchId,
    action:"CATALOG_F2_EFFECTIVE_BATCH_APPLIED",
    newValues:signF2ApplicationJournal({
      organizationId:authority.organizationId,batchId:authority.batchId,
      planDigest:plan.planDigest,effectiveAt:plan.effectiveAt,
      createdVersionIds:versions,journalEventIds:audits,
      changedRows:changes.length,unchangedRows:plan.unchangedRows,
    },authority.journalSigningSecret) as Prisma.InputJsonObject,
  }});
  return {
    state:"EFFECTIVE_VERSIONS_APPLIED",batchId:authority.batchId,
    createdVersionIds:versions,journalEventIds:audits,
    changedRows:changes.length,unchangedRows:plan.unchangedRows,
  };
}
