import type { Prisma } from "../../generated/prisma/client";
import { clinicalImportTestWhere, type ClinicalImportScope } from "./catalog-clinical-import-scope.ts";
import { catalogExportTypes, type CatalogExportType } from "./catalog-configuration-export.ts";
import { readCatalogLiveObservations } from "./catalog-live-observation.ts";
import {
  F2_EFFECTIVE_READ_TYPES, resolveF2EffectiveCatalogViews,
  projectF2EffectiveCatalogView, f2EffectiveCompositeMemberIds,
  f2EffectiveCompositeMembersAuthorized,
} from "./catalog-f2-effective-view.ts";

const readTypes=new Set<CatalogExportType>(F2_EFFECTIVE_READ_TYPES);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Match the configuration-export's effective as-of projection when comparing
 * the current live catalog to a staged bundle. Without this, the first
 * approved seven-class overlay is correctly exported but a second import's
 * approval/apply would compare against the unmodified physical master.
 *
 * The input must already be authorized to read EVERY referenced target:
 * readCatalogLiveObservations provides branch/department/tenant scoping
 * before the overlay lookup; overlay queries never authorize new identities.
 * Both reads run under the CALLER'S transaction and logical as-of instant.
 */
export async function readF2EffectiveLiveObservations(
  tx:Prisma.TransactionClient,
  scope:ClinicalImportScope,
  branchIds:readonly string[],
  idsByType:ReadonlyMap<CatalogExportType,string[]>,
  asOf:Date,
):Promise<Map<string,unknown>|null>{
  if(!Number.isFinite(asOf.getTime()) ||
     [...idsByType].some(([type,ids])=>
       !catalogExportTypes.has(type) || !Array.isArray(ids) ||
       ids.length>5000 || ids.some(id=>typeof id!=="string" || !UUID.test(id))))
    return null;
  const scoped=await readCatalogLiveObservations(
    tx,scope,branchIds,idsByType);
  if(!scoped)return null;
  const requested:Array<{entityType:typeof F2_EFFECTIVE_READ_TYPES[number];id:string}>=[];
  for(const [type,ids] of idsByType){
    if(!readTypes.has(type))continue;
    for(const id of ids){
      if(!scoped.has(type+":"+id))
        return null;
      requested.push({
        entityType:type as typeof F2_EFFECTIVE_READ_TYPES[number],id,
      });
    }
  }
  if(!requested.length)return scoped;
  const overlays=await resolveF2EffectiveCatalogViews(tx,{
    organizationId:scope.organizationId,asOf,records:requested,
  });
  for(const {entityType,id} of requested){
    const key=entityType+":"+id;
    const base=scoped.get(key);
    if(!base||typeof base!=="object"||Array.isArray(base))
      return null;
    const effective=projectF2EffectiveCatalogView(
      entityType,base as {id:string},overlays);
    // The signed field contract is JSON, not a Prisma result instance.
    scoped.set(key,JSON.parse(JSON.stringify(effective)));
  }
  // A scoped *base* PANEL/PACKAGE does not prove that the subsequent
  // effective snapshot has the same member tests. Validate every revised
  // member against the current branch/department test predicate before
  // exposing its ID or approving/applying the staged source.
  for(const kind of ["PANEL","PACKAGE"] as const){
    const changed=requested.filter(item=>item.entityType===kind &&
      overlays.has(kind+":"+item.id));
    if(!changed.length)continue;
    const composites=changed.map(item=>{
      const value=scoped.get(kind+":"+item.id);
      return {id:item.id,items:value&&typeof value==="object" &&
        !Array.isArray(value) && "items" in value?value.items:null};
    });
    const members=f2EffectiveCompositeMemberIds(kind,composites);
    if(!members)return null;
    const live=await tx.labTest.findMany({
      where:{...clinicalImportTestWhere(scope),
        id:{in:[...members.keys()]}},
      select:{id:true,code:true},
    });
    if(!f2EffectiveCompositeMembersAuthorized(members,live))
      return null;
  }
  return scoped;
}
