import {createHash,timingSafeEqual} from "node:crypto";
import type {Prisma} from "../../generated/prisma/client";
import {canonicalJson,type Json} from "./catalog-bundle-attestation.ts";
import {catalogBundleAllowedSourceFields} from "./catalog-bundle-source-boundary.ts";
import type {CatalogExportType} from "./catalog-configuration-export.ts";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA=/^[0-9a-f]{64}$/;
export const F2_EFFECTIVE_READ_TYPES=[
  "TEST","COMPONENT","UNIT","CONTAINER","PRICE_LIST",
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
