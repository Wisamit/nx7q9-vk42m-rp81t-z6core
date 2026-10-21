import { createHash } from "node:crypto";
import { canonicalJson, type Json } from "./catalog-bundle-attestation.ts";
import { catalogExportTypes, type CatalogExportType } from "./catalog-configuration-export.ts";
import { catalogBundleAllowedSourceFields } from "./catalog-bundle-source-boundary.ts";
import { BUNDLE_REVIEW_MAX_ROWS } from "./catalog-bundle-review.ts";
import { validF2ClinicalIntervalNumbers } from "./catalog-f2-clinical-values.ts";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const record=(value:unknown):value is Record<string,unknown>=>
  !!value && typeof value==="object" && !Array.isArray(value);
const equal=(a:unknown,b:unknown)=>{
  try{return canonicalJson(a as Json)===canonicalJson(b as Json);}
  catch{return false;}
};
const HASH=(v:unknown)=>createHash("sha256").update(
  canonicalJson(v as Json)).digest("hex");

export type F2ApplyOperation="UNCHANGED" | "SCALAR_VERSIONED_CHANGE" |
  "COMPOSITE_MEMBERSHIP_CHANGE" | "EFFECTIVE_DATED_NEW_VERSION";
export type F2ApplyPlanRow={
  rowNumber:number;entityType:CatalogExportType;targetId:string;
  operation:F2ApplyOperation;changedFields:readonly string[];
  originalSnapshot:Readonly<Record<string,unknown>>;
  desiredSnapshot:Readonly<Record<string,unknown>>;
  originalDigest:string;desiredDigest:string;
};
export type F2ApplyPlan={
  format:"F2_TEN_CLASS_EXECUTABLE_PLAN_V1";
  totalRows:number;changedRows:number;unchangedRows:number;
  operations:Readonly<Record<F2ApplyOperation,number>>;
  rows:readonly F2ApplyPlanRow[];
  planDigest:string;effectiveAt:string;
};
export type F2ApplySourceRow={
  rowNumber:number;entityType:string;
  sourceData:unknown;normalizedData:unknown;scopedLiveData:unknown;
};
const readonlyFields=new Set(["id","createdAt","updatedAt","deactivatedAt"]);
const identityFields:Record<CatalogExportType,readonly string[]>={
  TEST:["code","departmentId","specimenTypeId","containerId","methodId","defaultUnitId"],
  COMPONENT:["code","testId","unitId","resultSectionId","test","unit"],
  UNIT:["code","symbol"],CONTAINER:["code"],
  PANEL:["code"],PACKAGE:["code"],
  // Demographic/reference population selectors identify WHICH patients a
  // clinical interval applies to. They are not ordinary value amendments:
  // changing one requires a separately governed population replacement.
  REFERENCE_INTERVAL:["componentId","branchId","methodId","analyzerId",
    "specimenTypeId","sex","ageFrom","ageTo","ageUnit",
    "pregnancyStatus","gestationalAgeFromWeeks","gestationalAgeToWeeks",
    "populationCode","component"],
  PRICE_LIST:["code","scopeType","branchId","sourceId","referrerId",
    "clientId","contractId","currency"],
  PRICE_LIST_ITEM:["priceListId","testId","test","priceList"],
  PRICE_LIST_PACKAGE_ITEM:["priceListId","packageId","package","priceList"],
};
const versionTypes=new Set<CatalogExportType>([
  "REFERENCE_INTERVAL","PRICE_LIST_ITEM","PRICE_LIST_PACKAGE_ITEM",
]);
const compositeTypes=new Set<CatalogExportType>(["PANEL","PACKAGE"]);
const temporalFields=new Set(["effectiveFrom","effectiveTo","approvedAt","retiredAt"]);

/**
 * Creates a bounded exact-field plan from verified staging and current scoped
 * Prisma export projections. The caller MUST authenticate original source,
 * recheck BOTH signoffs/roles and execute under the same organization lock.
 *
 * No imported ID, createdAt, updatedAt, lifecycle date or parent/branch/tariff
 * identity is ever written. Clinical intervals and tariff prices MUST be
 * applied by a new effective-dated version; never in-place overwrite.
 *
 * Foreign installations need a separate authorized mapping, not this same-ID
 * plan. The snapshot is only for the transaction's protected audit journal.
 */
export function compileF2ApplyPlan(input:{
  rows:readonly F2ApplySourceRow[];effectiveAt:string;
  signedStageVerified:true;independentDomainApprovalsVerified:true;
  scopedLiveSnapshotVerified:true;
}):F2ApplyPlan|null{
  if(input.signedStageVerified!==true ||
     input.independentDomainApprovalsVerified!==true ||
     input.scopedLiveSnapshotVerified!==true ||
     !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(input.effectiveAt) ||
     !Number.isFinite(Date.parse(input.effectiveAt)) ||
     input.rows.length<1||input.rows.length>BUNDLE_REVIEW_MAX_ROWS)
    return null;
  const seen=new Set<string>();
  const rows:F2ApplyPlanRow[]=[];
  for(const [index,item] of input.rows.entries()){
    if(item.rowNumber!==index+1||
       !catalogExportTypes.has(item.entityType as CatalogExportType)||
       !record(item.sourceData)||!record(item.normalizedData)||
       !record(item.scopedLiveData))return null;
    const type=item.entityType as CatalogExportType;
    const source=item.sourceData,local=item.scopedLiveData;
    if(typeof item.normalizedData.id!=="string"||
       !UUID.test(item.normalizedData.id) ||
       source.id!==item.normalizedData.id ||
       local.id!==item.normalizedData.id)return null;
    const key=type+":"+source.id;
    if(seen.has(key))return null;
    seen.add(key);
    const fields=[...catalogBundleAllowedSourceFields[type]].sort();
    if(!equal(Object.keys(source).sort(),fields) ||
       !equal(Object.keys(local).sort(),fields))return null;
    // Mapped parent, ownership and natural identifiers cannot change during
    // a same-installation apply. Do not resolve a display code as an ID.
    if(identityFields[type].some(field=>!equal(source[field],local[field])))
      return null;
    // Preserve live identity/audit timestamps; comparing historic export
    // updatedAt against the new live updatedAt is NOT a configuration diff.
    if(type==="REFERENCE_INTERVAL" && !validF2ClinicalIntervalNumbers(source))
      return null;
    const changed=fields.filter(field=>!readonlyFields.has(field) &&
      !equal(source[field],local[field]));
    if(versionTypes.has(type) && changed.some(field=>temporalFields.has(field)))
      return null;
    if(type==="PRICE_LIST" && changed.some(field=>temporalFields.has(field)))
      return null;
    const op:F2ApplyOperation=changed.length===0?"UNCHANGED":
      versionTypes.has(type)?"EFFECTIVE_DATED_NEW_VERSION":
      compositeTypes.has(type)&&changed.includes("items")?
      "COMPOSITE_MEMBERSHIP_CHANGE":"SCALAR_VERSIONED_CHANGE";
    const original=structuredClone(local);
    const desired=structuredClone(source);
    for(const field of readonlyFields){
      // Some native projections (e.g. REFERENCE_INTERVAL) do not include
      // deactivatedAt. Never add undefined to a canonical signed snapshot.
      if(Object.hasOwn(desired,field))desired[field]=structuredClone(local[field]);
    }
    let oldHash:string,newHash:string;
    try {oldHash=HASH(original);newHash=HASH(desired);}
    catch{return null;}
    rows.push({
      rowNumber:item.rowNumber,entityType:type,targetId:source.id as string,
      operation:op,changedFields:changed,originalSnapshot:original,
      desiredSnapshot:desired,originalDigest:oldHash,desiredDigest:newHash,
    });
  }
  const operations:Record<F2ApplyOperation,number>={
    UNCHANGED:0,SCALAR_VERSIONED_CHANGE:0,
    COMPOSITE_MEMBERSHIP_CHANGE:0,EFFECTIVE_DATED_NEW_VERSION:0,
  };
  for(const row of rows)operations[row.operation]++;
  const body=[
    "FAMILY_LAB_F2_APPLY_PLAN_V1",input.effectiveAt,
    rows.map(row=>[
      row.rowNumber,row.entityType,row.targetId,row.operation,row.changedFields,
      row.originalDigest,row.desiredDigest,
    ]),
  ] as Json;
  return {
    format:"F2_TEN_CLASS_EXECUTABLE_PLAN_V1",totalRows:rows.length,
    changedRows:rows.length-operations.UNCHANGED,
    unchangedRows:operations.UNCHANGED,operations,rows,
    planDigest:HASH(body),effectiveAt:input.effectiveAt,
  };
}

/** No raw clinical/finance snapshots should ever enter ordinary JSON APIs. */
export function summarizeF2ApplyPlan(plan:F2ApplyPlan){
  return {
    format:plan.format,totalRows:plan.totalRows,
    changedRows:plan.changedRows,unchangedRows:plan.unchangedRows,
    operations:plan.operations,plannedTypes:[...new Set(plan.rows.map(x=>x.entityType))],
    effectiveAt:plan.effectiveAt,
    // Digests stay only in the protected application journal.
    reviewOnly:true,masterWritesPerformed:false,
  };
}

/**
 * Rebuild the exact canonical plan before ANY transactional master write.
 * A caller-supplied digest, changedField list, operation or snapshot is never
 * itself trusted. In particular, an attacker cannot forge UNCHANGED rows,
 * bypass future-version routing, replace the signed prior clinical threshold,
 * or alter the guarded effective date while retaining an older plan digest.
 *
 * This establishes internal plan integrity, NOT source provenance or user
 * authority. Authorization + fresh scoped live observation are separate,
 * mandatory checks performed by the transaction caller.
 */
export function verifyF2ApplyPlanIntegrity(value:unknown):value is F2ApplyPlan{
  if(!record(value) ||
     value.format!=="F2_TEN_CLASS_EXECUTABLE_PLAN_V1" ||
     typeof value.effectiveAt!=="string" ||
     !Array.isArray(value.rows) ||
     value.rows.length<1 || value.rows.length>BUNDLE_REVIEW_MAX_ROWS)
    return false;
  const rows:F2ApplySourceRow[]=[];
  for(const raw of value.rows){
    if(!record(raw)||!record(raw.originalSnapshot)||
       !record(raw.desiredSnapshot)||
       !Number.isSafeInteger(raw.rowNumber)||
       typeof raw.entityType!=="string"||
       typeof raw.targetId!=="string"||!UUID.test(raw.targetId))
      return false;
    rows.push({
      rowNumber:raw.rowNumber,entityType:raw.entityType,
      sourceData:raw.desiredSnapshot,
      normalizedData:{id:raw.targetId},
      scopedLiveData:raw.originalSnapshot,
    });
  }
  const reconstructed=compileF2ApplyPlan({
    rows,effectiveAt:value.effectiveAt,
    signedStageVerified:true,
    independentDomainApprovalsVerified:true,
    scopedLiveSnapshotVerified:true,
  });
  // Reject unknown keys, mismatched hashes, forged count/operation,
  // changedField ordering or modified whole-row snapshots.
  return reconstructed!==null && equal(value,reconstructed);
}
