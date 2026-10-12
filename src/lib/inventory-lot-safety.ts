import type { Prisma } from "../../generated/prisma/client";

export type LotSafetyAction="QUARANTINE"|"RECALL"|"RELEASE";
export type LotSafetyStatus="AVAILABLE"|"QUARANTINED"|"RECALLED";
export type LotSafetyRow={id:string;safety_status:LotSafetyStatus;status:string;item_id:string};

export function lotSafetyReason(value:unknown):string|null {
  if(typeof value!=="string")return null;
  const reason=value.trim();
  return reason.length>=20&&reason.length<=1000&&
    !/[\u0000-\u001f\u007f]/.test(reason)?reason:null;
}
export function lotSafetyNext(current:LotSafetyStatus,action:LotSafetyAction):LotSafetyStatus|null {
  if(action==="RECALL"&&current!=="RECALLED")return "RECALLED";
  if(action==="QUARANTINE"&&current==="AVAILABLE")return "QUARANTINED";
  if(action==="RELEASE"&&current==="QUARANTINED")return "AVAILABLE";
  return null;
}
/** Shared row-lock protocol: all stock writers and safety decisions acquire lot rows.
 * Locks are deterministic by UUID and persist until transaction commits.
 */
export async function lockLotsForSafety(
  tx:Prisma.TransactionClient,
  organizationId:string,
  lotIds:readonly string[],
):Promise<Map<string,LotSafetyRow>>{
  const ids=[...new Set(lotIds)].sort();
  if(ids.length===0)return new Map();
  const rows:LotSafetyRow[]=[];
  for(const id of ids){
    const found=await tx.$queryRaw<LotSafetyRow[]>`
      SELECT id, safety_status, status, item_id
      FROM inventory_lots
      WHERE organization_id=${organizationId} AND id=${id} FOR UPDATE
    `;
    if(found.length!==1)throw new Error("LOT_SAFETY_NOT_FOUND");
    rows.push(found[0]);
  }
  return new Map(rows.map(r=>[r.id,r]));
}
export function assertLotUsable(rows:ReadonlyMap<string,LotSafetyRow>,lotId:string){
  const lot=rows.get(lotId);
  if(!lot||lot.status!=="ACTIVE"||lot.safety_status!=="AVAILABLE")
    throw new Error("LOT_SAFETY_HOLD");
}
export function lotSafetyImpact(
  rows:readonly {branchId:string;quantityOnHand: {toString():string};
    reservedQty:{toString():string}}[],
){
  return rows.map(row=>({
    branchId:row.branchId,onHand:row.quantityOnHand.toString(),
    reserved:row.reservedQty.toString(),
  })).sort((a,b)=>a.branchId.localeCompare(b.branchId));
}
