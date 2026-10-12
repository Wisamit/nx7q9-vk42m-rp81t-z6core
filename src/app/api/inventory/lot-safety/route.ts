import {NextResponse} from "next/server";
import {getCurrentSession,permissionSet,requestContext} from "@/lib/auth";
import {prisma} from "@/lib/db";
import {lotSafetyImpact,lotSafetyNext,lotSafetyReason,lockLotsForSafety,
  type LotSafetyAction,type LotSafetyStatus} from "@/lib/inventory-lot-safety";

const noStore={"Cache-Control":"private, no-store"};
class LotSafetyConflict extends Error {
  constructor(public readonly reason:string){super(reason);}
}
export async function POST(request:Request){
 const session=await getCurrentSession();
 if(!session)return NextResponse.json({error:"unauthorized"},{status:401,headers:noStore});
 if(!permissionSet(session).has("inventory.manage"))
   return NextResponse.json({error:"inventory_manage_permission_required"},{status:403,headers:noStore});
 const size=Number(request.headers.get("content-length")||"0");
 if(size>4000)return NextResponse.json({error:"invalid_request_size"},{status:413,headers:noStore});
 const input=await request.json().catch(()=>null) as Record<string,unknown>|null;
 if(!input||Array.isArray(input))return NextResponse.json({error:"invalid_request"},{status:400,headers:noStore});
 const action=["QUARANTINE","RECALL","RELEASE"].includes(String(input.action))
   ? String(input.action) as LotSafetyAction:null;
 const lotId=typeof input.lotId==="string"&&
   /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.lotId)
   ? input.lotId:null;
 const reason=lotSafetyReason(input.reason);
 if(!action||!lotId||!reason)
   return NextResponse.json({error:"lot_action_reason_invalid"},{status:400,headers:noStore});
 const org=session.user.organizationId,branchId=session.activeBranchId;
 if(!branchId||!session.user.branchScopes.some(s=>
   s.branchId===branchId&&s.branch.organizationId===org&&s.branch.status==="ACTIVE"))
   return NextResponse.json({error:"active_branch_scope_required"},{status:403,headers:noStore});
 const ctx=await requestContext();
 try{
  const out=await prisma.$transaction(async tx=>{
   const [activeScope,activeBranch]=await Promise.all([
     tx.userBranchScope.findUnique({where:{userId_branchId:{
       userId:session.user.id,branchId}},select:{userId:true}}),
     tx.branch.findFirst({where:{id:branchId,organizationId:org,status:"ACTIVE"},select:{id:true}}),
   ]);
   if(!activeScope||!activeBranch)throw new LotSafetyConflict("branch_scope_changed");
   const locked=await lockLotsForSafety(tx,org,[lotId]);
   const current=locked.get(lotId);
   if(!current||current.status!=="ACTIVE")throw new LotSafetyConflict("lot_inactive_or_missing");
   const next=lotSafetyNext(current.safety_status,action);
   if(!next)throw new LotSafetyConflict("lot_safety_transition_forbidden");

   const stocks=await tx.inventoryLotStock.findMany({
     where:{lotId},select:{branchId:true,quantityOnHand:true,reservedQty:true},
   });
   // Quarantine and recall are emergency protective controls; any authorized
   // branch can contain risk across all branches without requiring full
   // organization visibility. Release is stricter: the reviewer needs scope
   // for every branch still holding or reserving the lot.
   if(action==="RELEASE"){
     const prior=await tx.inventoryLotSafetyEvent.findFirst({
       where:{lotId},orderBy:[{createdAt:"desc"},{id:"desc"}],
       select:{actorUserId:true,nextStatus:true},
     });
     if(!prior||prior.nextStatus!=="QUARANTINED"||prior.actorUserId===session.user.id)
       throw new LotSafetyConflict("independent_lot_release_review_required");
     const needed=stocks.filter(s=>s.quantityOnHand.gt(0)||s.reservedQty.gt(0))
       .map(s=>s.branchId);
     const assigned=await tx.userBranchScope.findMany({
       where:{userId:session.user.id,branchId:{in:needed},
         branch:{organizationId:org,status:"ACTIVE"}},select:{branchId:true},
     });
     if(assigned.length!==new Set(needed).size)
       throw new LotSafetyConflict("all_affected_branch_scopes_required");
     const activeTransfers=await tx.inventoryTransferItem.count({
       where:{lotId,transfer:{organizationId:org,status:{in:[
         "APPROVED","DISPATCHED","PARTIALLY_RECEIVED",
       ]}}},
     });
     if(activeTransfers>0)throw new LotSafetyConflict("pending_lot_transfers_require_resolution");
   }
   const changed=await tx.inventoryLot.updateMany({
     where:{id:lotId,organizationId:org,status:"ACTIVE",safetyStatus:current.safety_status},
     data:{safetyStatus:next},
   });
   if(changed.count!==1)throw new LotSafetyConflict("lot_safety_state_changed");
   const event=await tx.inventoryLotSafetyEvent.create({data:{
     organizationId:org,lotId,actorUserId:session.user.id,branchId,
     priorStatus:current.safety_status,nextStatus:next,reason,
     affectedStocks:lotSafetyImpact(stocks),
   }});
   await tx.auditEvent.create({data:{
     organizationId:org,branchId,actorUserId:session.user.id,
     action:action==="QUARANTINE"?"INVENTORY_LOT_QUARANTINED":
       action==="RECALL"?"INVENTORY_LOT_RECALLED":"INVENTORY_LOT_RELEASED_FROM_QUARANTINE",
     entityType:"InventoryLot",entityId:lotId,
     oldValues:{safetyStatus:current.safety_status},
     newValues:{safetyStatus:next,eventId:event.id,
       affectedBranchCount:stocks.length,
       affectedLotStocks:lotSafetyImpact(stocks)},
     reason,ipAddress:ctx.ipAddress,userAgent:ctx.userAgent,
   }});
   return {eventId:event.id,lotId,safetyStatus:next};
  },{isolationLevel:"Serializable",timeout:30000});
  return NextResponse.json({status:"ok",...out},{headers:noStore});
 }catch(error){
  const code=error instanceof LotSafetyConflict?error.reason:"inventory_lot_safety_conflict";
  return NextResponse.json({error:code},{status:409,headers:noStore});
 }
}
