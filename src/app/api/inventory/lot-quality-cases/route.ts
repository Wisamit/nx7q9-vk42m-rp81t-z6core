import {randomUUID} from "node:crypto";
import {NextResponse} from "next/server";
import {getCurrentSession,permissionSet,requestContext} from "@/lib/auth";
import {prisma} from "@/lib/db";
export const dynamic="force-dynamic";
class CaseConflict extends Error {constructor(public code:string){super(code);}}
const stamp=()=>new Date().toISOString().slice(0,10).replaceAll("-","");
export async function POST(request:Request) {
 const session=await getCurrentSession();
 if(!session)return NextResponse.json({error:"unauthorized"},{status:401});
 const permissions=permissionSet(session);
 if(!permissions.has("quality.nonconformance.manage")||!permissions.has("inventory.view"))
   return NextResponse.json({error:"quality_permission_required"},{status:403});
 const branchId=session.activeBranchId,organizationId=session.user.organizationId;
 if(!branchId||!session.user.branchScopes.some(s=>s.branchId===branchId&&s.branch.status==="ACTIVE"&&s.branch.organizationId===organizationId))
   return NextResponse.json({error:"active_branch_scope_required"},{status:403});
 const raw:unknown=await request.json().catch(()=>null);
 if(!raw||typeof raw!=="object"||Array.isArray(raw))
   return NextResponse.json({error:"invalid_request"},{status:400});
 const body=raw as Record<string,unknown>;
 const lotId=typeof body.lotId==="string"?body.lotId:"";
 const safetyEventId=typeof body.safetyEventId==="string"?body.safetyEventId:"";
 const title=typeof body.title==="string"?body.title.trim():"";
 const description=typeof body.description==="string"?body.description.trim():"";
 const severity=body.severity;
 if(!/^[a-f0-9-]{36}$/i.test(lotId)||!/^[a-f0-9-]{36}$/i.test(safetyEventId)||
   title.length<15||title.length>255||description.length<30||description.length>5000||
   (severity!=="MAJOR"&&severity!=="CRITICAL"))
   return NextResponse.json({error:"invalid_recall_quality_fields"},{status:400});
 const ctx=await requestContext();
 try{
  const created=await prisma.$transaction(async tx=>{
   const scope=await tx.userBranchScope.findUnique({where:{userId_branchId:{userId:session.user.id,branchId}},select:{userId:true}});
   const branch=await tx.branch.findFirst({where:{id:branchId,organizationId,status:"ACTIVE"},select:{id:true}});
   if(!scope||!branch)throw new CaseConflict("branch_scope_changed");
   // Lock the exact lot before deciding the current safety event. The same
   // lock order is used by the lot safety and branch response workflows.
   const locked=await tx.$queryRaw<Array<{id:string}>>`
     SELECT id FROM inventory_lots WHERE id=${lotId}
       AND organization_id=${organizationId} AND status='ACTIVE' FOR UPDATE
   `;
   if(locked.length!==1)throw new CaseConflict("lot_unavailable");
   const lot=await tx.inventoryLot.findUniqueOrThrow({where:{id:lotId},select:{safetyStatus:true}});
   if(lot.safetyStatus!=="QUARANTINED"&&lot.safetyStatus!=="RECALLED")
     throw new CaseConflict("lot_safety_hold_not_active");
   const latest=await tx.inventoryLotSafetyEvent.findFirst({where:{lotId,organizationId},
     orderBy:[{createdAt:"desc"},{id:"desc"}],select:{id:true,nextStatus:true}});
   if(!latest||latest.id!==safetyEventId||!["QUARANTINED","RECALLED"].includes(latest.nextStatus))
     throw new CaseConflict("stale_safety_event");
   // A quality case requires the branch's own immutable escalation evidence.
   // Mere ownership of a lot does not grant access to another branch response.
   const escalated=await tx.inventoryLotBranchResponse.findFirst({where:{
     organizationId,lotId,branchId,safetyEventId,action:"ESCALATED_TO_QUALITY",
   },select:{id:true,note:true,createdAt:true}});
   if(!escalated)throw new CaseConflict("branch_quality_escalation_required");
   const existing=await tx.inventoryLotQualityCase.findFirst({where:{
     safetyEventId,branchId,
   },select:{nonconformanceId:true}});
   if(existing)throw new CaseConflict("quality_case_already_linked");
   const nc=await tx.nonconformance.create({data:{
     organizationId,branchId,caseNumber:"NC-LOT-"+stamp()+"-"+randomUUID().slice(0,8).toUpperCase(),
     title,description,category:"INVENTORY_LOT_SAFETY",severity,
     sourceEntityType:"InventoryLotSafetyEvent",sourceEntityId:safetyEventId,
     immediateAction:escalated.note,
     reportedByUserId:session.user.id,ownerUserId:session.user.id,
   }});
   const link=await tx.inventoryLotQualityCase.create({data:{
     organizationId,lotId,branchId,safetyEventId,nonconformanceId:nc.id,
     createdByUserId:session.user.id,
   }});
   await tx.auditEvent.create({data:{
     organizationId,branchId,actorUserId:session.user.id,
     action:"INVENTORY_RECALL_QUALITY_CASE_OPENED",entityType:"Nonconformance",entityId:nc.id,
     newValues:{lotId,safetyEventId,branchResponseId:escalated.id,
       qualityCaseLinkId:link.id,caseNumber:nc.caseNumber,severity,
       clinicalExposure:"NOT_DETERMINED",stockSafetyState:lot.safetyStatus},
     ipAddress:ctx.ipAddress,userAgent:ctx.userAgent,
   }});
   return {id:nc.id,caseNumber:nc.caseNumber,linkId:link.id};
  },{isolationLevel:"Serializable",timeout:30000});
  return NextResponse.json({status:"ok",nonconformance:created},{status:201});
 }catch(error){
  if(error instanceof CaseConflict)
    return NextResponse.json({error:error.code},{status:409});
  // Unique event/branch DB constraint is final concurrency fence.
  return NextResponse.json({error:"quality_case_state_conflict"},{status:409});
 }
}
