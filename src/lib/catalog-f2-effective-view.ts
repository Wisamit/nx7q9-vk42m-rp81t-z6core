import {createHash,timingSafeEqual} from "node:crypto";
import type {Prisma} from "../../generated/prisma/client";
import {canonicalJson,type Json} from "./catalog-bundle-attestation.ts";
import {catalogBundleAllowedSourceFields} from "./catalog-bundle-source-boundary.ts";
import type {CatalogExportType} from "./catalog-configuration-export.ts";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA=/^[0-9a-f]{64}$/;
export const F2_EFFECTIVE_READ_TYPES=[
  "TEST","COMPONENT","UNIT","CONTAINER","PRICE_LIST",
  "PANEL","PACKAGE",
] as const satisfies readonly CatalogExportType[];
type ReadType=typeof F2_EFFECTIVE_READ_TYPES[number];
const viewFields=(type:ReadType)=>catalogBundleAllowedSourceFields[type]
  .filter(field=>!["id","createdAt","updatedAt","deactivatedAt",
    "test","unit"].includes(field));
const isObj=(value:unknown):value is Record<string,unknown> =>
  value!==null&&typeof value==="object"&&!Array.isArray(value);
const key=(type:string,id:string)=>type+":"+id.toLowerCase();

function verifiedEffectiveSnapshot(
  value:unknown,expectedId:string,digest:string,type:ReadType,
):Record<string,unknown>{
  if(!isObj(value)||value.id!==expectedId||
     !SHA.test(digest)||
     Object.keys(value).sort().join(",")!==
       [...catalogBundleAllowedSourceFields[type]].sort().join(","))
    throw Error("f2_effective_snapshot_invalid");
  const bytes=createHash("sha256")
    .update(canonicalJson(value as Json)).digest();
  if(!timingSafeEqual(bytes,Buffer.from(digest,"hex")))
    throw Error("f2_effective_snapshot_digest_invalid");
  return value;
}

/**
 * Resolve only currently effective, HMAC-digest-verified, immutable overlays
 * for catalog listing and selectors. No staging, future revision or cancelled
 * revision is made visible. Live relations remain the database's relations.
 *
 * Caller must have already filtered each target to their organization and
 * own active branch/department permission scope. Never pass user-supplied
 * unscoped IDs. A scoped full read uses the same transaction and as-of time.
 */
export async function resolveF2EffectiveCatalogViews(
  tx:Prisma.TransactionClient,params:{
    organizationId:string;asOf:Date;
    records:readonly {entityType:ReadType;id:string}[];
  },
):Promise<ReadonlyMap<string,Readonly<Record<string,unknown>>>>{
  const {organizationId,asOf,records}=params;
  if(!UUID.test(organizationId)||!Number.isFinite(asOf.getTime())||
     records.length>5000||
     records.some(item=>!F2_EFFECTIVE_READ_TYPES.includes(item.entityType)||
       !UUID.test(item.id)))
    throw Error("f2_effective_read_scope_invalid");
  const requested=new Set(records.map(x=>key(x.entityType,x.id)));
  if(requested.size!==records.length)
    throw Error("f2_effective_read_duplicate_target");
  if(!requested.size)return new Map();
  const overlays=new Map<string,Readonly<Record<string,unknown>>>();
  for(const type of F2_EFFECTIVE_READ_TYPES){
    const ids=records.filter(item=>item.entityType===type).map(item=>item.id);
    if(!ids.length)continue;
    const rows=await tx.catalogConfigurationRevision.findMany({
      where:{organizationId,entityType:type,entityId:{in:ids},
        state:"RECORDED",effectiveFrom:{lte:asOf},
        OR:[{effectiveTo:null},{effectiveTo:{gt:asOf}}]},
      select:{entityId:true,afterSnapshot:true,desiredDigest:true},
      take:ids.length+1,
    });
    if(rows.length>ids.length)
      throw Error("f2_effective_read_overlapping_versions");
    for(const row of rows){
      const target=key(type,row.entityId);
      if(!requested.has(target)||overlays.has(target))
        throw Error("f2_effective_read_cross_scope_or_overlap");
      const snapshot=verifiedEffectiveSnapshot(
        row.afterSnapshot,row.entityId,row.desiredDigest,type,
      );
      const safe:Record<string,unknown>={};
      for(const field of viewFields(type))safe[field]=snapshot[field];
      overlays.set(target,safe);
    }
  }
  return overlays;
}

/** Overlay selected source fields, preserving live Prisma relation objects. */
export function projectF2EffectiveCatalogView<T extends {id:string}>(
  entityType:ReadType,record:T,
  overlays:ReadonlyMap<string,Readonly<Record<string,unknown>>>,
):T{
  const fields=overlays.get(key(entityType,record.id));
  if(!fields)return record;
  return {...record,...fields};
}

/**
 * Every effective composite member must be authorized in the exporter's
 * current clinical department/branch scope. Base membership scoping does
 * not protect a future revision that adds a different test.
 *
 * Callers must query all returned IDs using their existing scoped testWhere
 * and fail the export unless this helper returns true.
 */
export function f2EffectiveCompositeMemberIds(
  kind:"PANEL"|"PACKAGE",
  records:readonly {id:string;items?:unknown}[],
):ReadonlyMap<string,string>|null {
  const membership=new Map<string,string>();
  for(const row of records){
    const items=(row as {items?:unknown}).items;
    if(!Array.isArray(items)||items.length<1||items.length>1000)return null;
    const local=new Set<string>();
    const ordered:{id:string;code:string;position:number}[]=[];
    for(const member of items){
      if(!isObj(member)||typeof member.testId!=="string"||
         !UUID.test(member.testId)||local.has(member.testId.toLowerCase())||
         typeof member.displayOrder!=="number"||
         !Number.isSafeInteger(member.displayOrder)||
         member.displayOrder<0||
         !isObj(member.test)||
         typeof member.test.code!=="string"||!member.test.code||
         Object.keys(member.test).join(",")!=="code"||
         Object.keys(member).sort().join(",")!==
           (kind==="PANEL"?"displayOrder,required,test,testId":"displayOrder,test,testId")||
         (kind==="PANEL"&&typeof member.required!=="boolean"))
        return null;
      const canonicalId=member.testId.toLowerCase();
      local.add(canonicalId);
      ordered.push({id:canonicalId,code:member.test.code,
        position:member.displayOrder});
    }
    // The existing SQL schema permits equal displayOrder values (default 0).
    // Preserve that valid historic configuration, but resolve ties by the
    // immutable UUID to make new order membership deterministic.
    ordered.sort((a,b)=>a.position-b.position ||
      a.id.localeCompare(b.id));
    for(const entry of ordered){
      const prior=membership.get(entry.id);
      if(prior!==undefined && prior!==entry.code)return null;
      membership.set(entry.id,entry.code);
      if(membership.size>5000)return null;
    }
  }
  return membership;
}
export function f2EffectiveCompositeMembersAuthorized(
  membership:ReadonlyMap<string,string>,
  permitted:readonly {id:string;code:string}[],
):boolean {
  if(permitted.length!==membership.size)return false;
  const seen=new Set<string>();
  return permitted.every(test=>{
    if(!UUID.test(test.id))return false;
    const canonicalId=test.id.toLowerCase();
    return !seen.has(canonicalId)&&
      (seen.add(canonicalId),membership.get(canonicalId)===test.code);
  });
}
