import {canonicalJson,type Json} from "./catalog-bundle-attestation.ts";
import {catalogExportTypes,type CatalogExportType} from "./catalog-configuration-export.ts";
import {catalogBundleAllowedSourceFields} from "./catalog-bundle-source-boundary.ts";
import {verifyF2ApplyPlanIntegrity,type F2ApplyPlan} from "./catalog-f2-apply-plan.ts";

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const obj=(x:unknown):x is Record<string,unknown> =>
  x!==null&&typeof x==="object"&&!Array.isArray(x);
const native=new Set<CatalogExportType>([
  "REFERENCE_INTERVAL","PRICE_LIST_ITEM","PRICE_LIST_PACKAGE_ITEM",
]);
const mutableHistory=new Set([
  "createdAt","updatedAt","deactivatedAt","approvedAt","retiredAt",
]);
const same=(a:unknown,b:unknown)=>{
  try{return canonicalJson(a as Json)===canonicalJson(b as Json);}
  catch{return false;}
};
export type F2EffectiveExportRow={
  entityType:string;record:unknown;
};
export type F2NativeVersionLink={
  entityType:"REFERENCE_INTERVAL"|"PRICE_LIST_ITEM"|"PRICE_LIST_PACKAGE_ITEM";
  originalId:string;createdVersionId:string;
};
export type F2RoundTripParity={
  state:"F2_TEN_CLASS_EFFECTIVE_EXPORT_PARITY_VERIFIED";
  totalRows:number;typeCounts:Readonly<Record<CatalogExportType,number>>;
  nativeVersionRows:number;effectiveAt:string;matches:true;
};
/**
 * Verifies the complete post-effective export, including nested structures.
 * Seven overlay classes retain their UUID; three clinical/tariff classes
 * must match independently journaled old->new UUID links. A new version has
 * new timestamps, and its effectiveFrom must equal the approved effective
 * date; all actual clinical/financial and relational fields MUST match.
 *
 * This consumes trusted internal re-export records and a verified apply
 * journal only; it is NOT a public API, proof of clinical correctness or
 * permission to apply. The caller owns tenant/branch scoped reads.
 */
export function verifyF2TenClassRoundTrip(input:{
  plan:F2ApplyPlan;
  reexportRows:readonly F2EffectiveExportRow[];
  nativeVersionLinks:readonly F2NativeVersionLink[];
  stageAndJournalVerified:true;scopedAsOfVerified:true;
}):F2RoundTripParity|null{
  const {plan,reexportRows,nativeVersionLinks}=input;
  if(input.stageAndJournalVerified!==true||input.scopedAsOfVerified!==true||
     !verifyF2ApplyPlanIntegrity(plan)||plan.rows.length<10||
     new Set(plan.rows.map(x=>x.entityType)).size!==catalogExportTypes.size||
     reexportRows.length!==plan.rows.length ||
     nativeVersionLinks.length!==plan.rows.filter(x=>
       native.has(x.entityType)&&x.operation==="EFFECTIVE_DATED_NEW_VERSION").length)
    return null;
  const links=new Map<string,string>(),versions=new Set<string>();
  for(const link of nativeVersionLinks){
    if(!native.has(link.entityType)||!UUID.test(link.originalId)||
       !UUID.test(link.createdVersionId)||
       link.originalId.toLowerCase()===link.createdVersionId.toLowerCase())
      return null;
    const key=link.entityType+":"+link.originalId.toLowerCase();
    const version=link.entityType+":"+link.createdVersionId.toLowerCase();
    if(links.has(key)||versions.has(version))return null;
    links.set(key,link.createdVersionId.toLowerCase());
    versions.add(version);
  }
  const observed=new Map<string,Record<string,unknown>>();
  for(const row of reexportRows){
    if(!catalogExportTypes.has(row.entityType as CatalogExportType)||
       !obj(row.record)||typeof row.record.id!=="string"||
       !UUID.test(row.record.id))return null;
    const key=row.entityType+":"+row.record.id.toLowerCase();
    if(observed.has(key))return null;
    observed.set(key,row.record);
  }
  const counts=Object.fromEntries(
    [...catalogExportTypes].map(type=>[type,0]),
  ) as Record<CatalogExportType,number>;
  const consumed=new Set<string>();
  for(const row of plan.rows){
    const key=row.entityType+":"+row.targetId.toLowerCase();
    const expectedVersion=native.has(row.entityType)&&
      row.operation==="EFFECTIVE_DATED_NEW_VERSION";
    const actualId=expectedVersion?links.get(key):row.targetId.toLowerCase();
    if(!actualId||(!expectedVersion&&links.has(key)))return null;
    const observedKey=row.entityType+":"+actualId;
    const actual=observed.get(observedKey);
    if(!actual||consumed.has(observedKey)||!obj(row.desiredSnapshot))return null;
    consumed.add(observedKey);
    counts[row.entityType]++;
    const fields=[...catalogBundleAllowedSourceFields[row.entityType]].sort();
    if(!same(Object.keys(actual).sort(),fields)||
       !same(Object.keys(row.desiredSnapshot).sort(),fields)||
       actual.id?.toString().toLowerCase()!==actualId)return null;
    if(expectedVersion){
      if(actual.effectiveFrom!==plan.effectiveAt ||
         actual.effectiveTo!==null)return null;
    }
    for(const field of fields){
      if(mutableHistory.has(field)||
         (expectedVersion&&(field==="id"||field==="effectiveFrom")))
        continue;
      if(!same(actual[field],row.desiredSnapshot[field]))return null;
    }
  }
  if(consumed.size!==observed.size)return null;
  return {state:"F2_TEN_CLASS_EFFECTIVE_EXPORT_PARITY_VERIFIED",
    totalRows:plan.rows.length,typeCounts:counts,
    nativeVersionRows:links.size,effectiveAt:plan.effectiveAt,matches:true};
}
