import { NextResponse } from "next/server";
import {getCurrentSession,permissionSet,requestContext} from "@/lib/auth";
import {prisma} from "@/lib/db";
import {lockLotsForSafety} from "@/lib/inventory-lot-safety";
import {validLotResponse,lotResponseNote} from "@/lib/inventory-lot-branch-response";

const noStore={"Cache-Control":"private, no-store"};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
class ResponseConflict extends Error {constructor(readonly code:string){super(code);}}
export async function POST(request:Request){
 const session=await getCurrentSession();
 if(!session)return NextResponse.json({error:"unauthorized"},{status:401,headers:noStore});
 if(!permissionSet(session).has("inventory.manage"))
   return NextResponse.json({error:"inventory_manage_permission_required"},{status:403,headers:noStore});
 if(Number(request.headers.get("content-length")||0)>4000)
   return NextResponse.json({error:"invalid_request_size"},{status:413,headers:noStore});
 const input=await request.json().catch(()=>null) as Record<string,unknown>|null;
 if(!input||Array.isArray(input)||typeof input!=="object"||
   typeof input.lotId!=="string"||!uuid.test(input.lotId)||
   typeof input.safetyEventId!=="string"||!uuid.test(input.safetyEventId)||
   !validLotResponse(input.action)||!lotResponseNote(input.note))
   return NextResponse.json({error:"invalid_lot_response"},{status:400,headers:noStore});
 const lotId=input.lotId, safetyEventId=input.safetyEventId,
   action=input.action,note=lotResponseNote(input.note)!;
 const org=session.user.organizationId,branchId=session.activeBranchId;
 if(!branchId||!session.user.branchScopes.some(s=>s.branchId===branchId&&
     s.branch.organizationId===org&&s.branch.status==="ACTIVE"))
   return NextResponse.json({error:"active_branch_scope_required"},{status:403,headers:noStore});
 const ctx=await requestContext();
 try{
   const answer=await prisma.$transaction(async tx=>{
     // Lock the parent lot row in the same global order as Stage 97 safety
     // transitions. A new recall revision cannot race a stale response.
     const locked=await lockLotsForSafety(tx,org,[lotId]);
     const lot=locked.get(lotId);
     if(!lot||lot.status!=="ACTIVE"||!["QUARANTINED","RECALLED"].includes(lot.safety_status))
       throw new ResponseConflict("lot_not_under_safety_hold");
     const [scope,branch]=await Promise.all([
       tx.userBranchScope.findUnique({where:{userId_branchId:{
         userId:session.user.id,branchId}},select:{userId:true}}),
       tx.branch.findFirst({where:{id:branchId,organizationId:org,status:"ACTIVE"},select:{id:true}}),
     ]);
     if(!scope||!branch)throw new ResponseConflict("branch_scope_changed");
     const latest=await tx.inventoryLotSafetyEvent.findFirst({
       where:{lotId,organizationId:org},
       orderBy:[{createdAt:"desc"},{id:"desc"}],
       select:{id:true,nextStatus:true},
     });
     if(!latest||latest.id!==safetyEventId||latest.nextStatus!==lot.safety_status)
       throw new ResponseConflict("safety_decision_changed");
     // A staff member must respond only for a branch with its own stock or
     // historical movement/transfer/QC trace for this particular lot.
     const [stock,moves,transfers,qc]=await Promise.all([
       tx.inventoryLotStock.count({where:{lotId,branchId}}),
       tx.stockMovement.count({where:{lotId,organizationId:org,branchId}}),
       tx.inventoryTransferItem.count({where:{lotId,transfer:{organizationId:org,OR:[
         {sourceBranchId:branchId},{destinationBranchId:branchId},
       ]}}}),
       tx.qcResult.count({where:{target:{qcLot:{inventoryLotId:lotId,organizationId:org}},
         run:{organizationId:org,branchId}}}),
     ]);
     if(stock+moves+transfers+qc===0)throw new ResponseConflict("branch_not_affected_by_lot");
     const existing=await tx.inventoryLotBranchResponse.findFirst({where:{
       safetyEventId,branchId,action,
     },select:{id:true}});
     if(existing)throw new ResponseConflict("response_already_recorded");
     const response=await tx.inventoryLotBranchResponse.create({data:{
       organizationId:org,lotId,branchId,safetyEventId,actorUserId:session.user.id,
       action,note,
     }});
     await tx.auditEvent.create({data:{
       organizationId:org,branchId,actorUserId:session.user.id,
       action:"INVENTORY_LOT_BRANCH_RESPONSE_RECORDED",
       entityType:"InventoryLotBranchResponse",entityId:response.id,
       newValues:{lotId,safetyEventId,action,note,
         clinicalExposure:"NOT_DETERMINED",stockReleased:false},
       ipAddress:ctx.ipAddress,userAgent:ctx.userAgent,
     }});
     return {id:response.id,safetyEventId,action} as const;
   },{isolationLevel:"Serializable",timeout:30000});
   return NextResponse.json({status:"ok",response:answer},{status:201,headers:noStore});
 }catch(error){
   if(error instanceof ResponseConflict)
     return NextResponse.json({error:error.code},{status:409,headers:noStore});
   // Database uniqueness / concurrency failure is never retried as a new
   // clinical acknowledgement or silently accepted.
   return NextResponse.json({error:"lot_response_conflict"},{status:409,headers:noStore});
 }
}
