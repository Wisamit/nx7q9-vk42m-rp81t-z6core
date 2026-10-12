import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { permissionSet, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  ClinicalHandoverError, clinicalHandoverFingerprint, isClinicalUuid,
  lockClinicalOrder, parseClinicalHandoverInput, validClinicalReason,
} from "@/lib/order-clinical-handover";

const noStore = { "Cache-Control": "private, no-store" };
function failure(error: unknown) {
  if (error instanceof ClinicalHandoverError)
    return NextResponse.json({ error: error.code }, { status: error.statusCode, headers: noStore });
  return NextResponse.json({ error: "clinical_handover_conflict" }, { status: 409, headers: noStore });
}

export async function POST(request: Request, {params}: {params:Promise<{id:string}>}) {
  const session=await requirePermission("orders.view");
  const rights=permissionSet(session);
  if (!rights.has("orders.create"))
    return NextResponse.json({error:"clinical_note_create_forbidden"},{status:403,headers:noStore});
  const {id:orderId}=await params;
  if (!isClinicalUuid(orderId))
    return NextResponse.json({error:"invalid_order"},{status:400,headers:noStore});
  try {
    const input=parseClinicalHandoverInput(await request.json().catch(()=>null));
    const organizationId=session.user.organizationId, actorId=session.user.id;
    const fingerprint=clinicalHandoverFingerprint(orderId,input);
    const ctx=await requestContext();
    const outcome=await prisma.$transaction(async tx=>{
      const order=await lockClinicalOrder(tx,{
        orderId,organizationId,actorId,activeBranchId:session.activeBranchId,
        scopedBranchIds:session.user.branchScopes
          .filter(x=>x.branch.status==="ACTIVE" && x.branch.organizationId===organizationId)
          .map(x=>x.branchId),
      });
      const duplicate=await tx.orderClinicalNote.findFirst({
        where:{organizationId,createdByUserId:actorId,clientRequestId:input.clientRequestId},
        select:{id:true,orderId:true,requestFingerprint:true,status:true},
      });
      if(duplicate) {
        if(duplicate.orderId!==orderId || duplicate.requestFingerprint!==fingerprint)
          throw new ClinicalHandoverError("clinical_note_key_reused_with_different_content");
        return {id:duplicate.id,status:duplicate.status,replayed:true};
      }
      if(order.status==="CANCELLED")
        throw new ClinicalHandoverError("cancelled_order_not_editable");
      let threadId: string = randomUUID();
      let revisionNumber = 1;
      if(input.replacesNoteId) {
        const locks=await tx.$queryRaw<Array<{id:string}>>`
          SELECT id FROM order_clinical_notes WHERE id=${input.replacesNoteId}
          AND organization_id=${organizationId} AND order_id=${orderId}
          AND branch_id=${order.branchId} FOR UPDATE
        `;
        if(locks.length!==1)throw new ClinicalHandoverError("clinical_note_not_found",404);
        const prior=await tx.orderClinicalNote.findFirst({
          where:{id:input.replacesNoteId,organizationId,orderId,branchId:order.branchId},
        });
        if(!prior || prior.status!=="ACTIVE")
          throw new ClinicalHandoverError("clinical_note_no_longer_active");
        if(prior.createdByUserId!==actorId && !rights.has("results.medical_validate"))
          throw new ClinicalHandoverError("clinical_note_correction_forbidden",403);
        const retired=await tx.orderClinicalNote.updateMany({
          where:{id:prior.id,organizationId,orderId,status:"ACTIVE"},
          data:{status:"SUPERSEDED",retiredAt:new Date(),retiredByUserId:actorId,
            retirementReason:input.correctionReason},
        });
        if(retired.count!==1)throw new ClinicalHandoverError("clinical_note_no_longer_active");
        threadId=prior.threadId;
        revisionNumber=prior.revisionNumber+1;
      }
      const note=await tx.orderClinicalNote.create({data:{
        organizationId,branchId:order.branchId,orderId,threadId,revisionNumber,
        clientRequestId:input.clientRequestId,requestFingerprint:fingerprint,
        category:input.category,language:input.language,body:input.body,
        requiresAcknowledgement:input.requiresAcknowledgement,
        replacesNoteId:input.replacesNoteId,correctionReason:input.correctionReason,
        createdByUserId:actorId,
      }});
      await tx.auditEvent.create({data:{
        organizationId,branchId:order.branchId,actorUserId:actorId,
        action:input.replacesNoteId?"ORDER_CLINICAL_HANDOVER_CORRECTED":"ORDER_CLINICAL_HANDOVER_CREATED",
        entityType:"OrderClinicalNote",entityId:note.id,
        reason:input.correctionReason,
        oldValues:input.replacesNoteId?{replacedNoteId:input.replacesNoteId}:undefined,
        newValues:{orderId,threadId,revisionNumber,category:input.category,
          language:input.language,textSha256:fingerprint,
          requiresAcknowledgement:input.requiresAcknowledgement,
          visibility:"STAFF_ONLY",reportEffect:"NONE"},
        ipAddress:ctx.ipAddress,userAgent:ctx.userAgent,
      }});
      return {id:note.id,status:note.status,replayed:false};
    },{isolationLevel:"Serializable",timeout:45000});
    return NextResponse.json(outcome,{status:outcome.replayed?200:201,headers:noStore});
  }catch(error){return failure(error);}
}

export async function PATCH(request: Request,{params}:{params:Promise<{id:string}>}) {
  const session=await requirePermission("orders.view");
  const rights=permissionSet(session);
  const {id:orderId}=await params;
  if(!isClinicalUuid(orderId))
    return NextResponse.json({error:"invalid_order"},{status:400,headers:noStore});
  const raw:unknown=await request.json().catch(()=>null);
  if(!raw||typeof raw!=="object"||Array.isArray(raw))
    return NextResponse.json({error:"invalid_request"},{status:400,headers:noStore});
  const input=raw as Record<string,unknown>;
  if(!isClinicalUuid(input.noteId)||!["ACKNOWLEDGE","RETRACT"].includes(String(input.action))||
    (input.action==="RETRACT"&&!validClinicalReason(input.reason)))
    return NextResponse.json({error:"invalid_handover_action"},{status:400,headers:noStore});
  if(input.action==="RETRACT"&&!rights.has("orders.create"))
    return NextResponse.json({error:"clinical_note_retract_forbidden"},{status:403,headers:noStore});
  const organizationId=session.user.organizationId,actorId=session.user.id,ctx=await requestContext();
  try{
    const result=await prisma.$transaction(async tx=>{
      const order=await lockClinicalOrder(tx,{
        orderId,organizationId,actorId,activeBranchId:session.activeBranchId,
        scopedBranchIds:session.user.branchScopes
          .filter(x=>x.branch.status==="ACTIVE"&&x.branch.organizationId===organizationId)
          .map(x=>x.branchId),
      });
      const locked=await tx.$queryRaw<Array<{id:string}>>`
        SELECT id FROM order_clinical_notes WHERE id=${input.noteId}
        AND organization_id=${organizationId}
        AND order_id=${orderId} AND branch_id=${order.branchId} FOR UPDATE
      `;
      if(locked.length!==1)throw new ClinicalHandoverError("clinical_note_not_found",404);
      const note=await tx.orderClinicalNote.findFirst({
        where:{id:input.noteId as string,organizationId,orderId,branchId:order.branchId},
      });
      if(!note)throw new ClinicalHandoverError("clinical_note_not_found",404);
      if(note.status!=="ACTIVE")
        throw new ClinicalHandoverError("clinical_note_no_longer_active");
      if(input.action==="ACKNOWLEDGE") {
        if(!note.requiresAcknowledgement)
          throw new ClinicalHandoverError("clinical_note_ack_not_required");
        if(note.createdByUserId===actorId)
          throw new ClinicalHandoverError("independent_acknowledgement_required",403);
        const existing=await tx.orderClinicalNoteAcknowledgement.findUnique({
          where:{noteId_acknowledgedByUserId:{noteId:note.id,acknowledgedByUserId:actorId}},
          select:{id:true},
        });
        if(existing)return {id:note.id,action:"ACKNOWLEDGE",replayed:true};
        await tx.orderClinicalNoteAcknowledgement.create({
          data:{noteId:note.id,acknowledgedByUserId:actorId},
        });
        await tx.auditEvent.create({data:{
          organizationId,branchId:order.branchId,actorUserId:actorId,
          action:"ORDER_CLINICAL_HANDOVER_ACKNOWLEDGED",entityType:"OrderClinicalNote",
          entityId:note.id,newValues:{orderId,threadId:note.threadId,revisionNumber:note.revisionNumber},
          ipAddress:ctx.ipAddress,userAgent:ctx.userAgent,
        }});
        return {id:note.id,action:"ACKNOWLEDGE",replayed:false};
      }
      if(note.createdByUserId!==actorId&&!rights.has("results.medical_validate"))
        throw new ClinicalHandoverError("clinical_note_retraction_forbidden",403);
      const reason=(input.reason as string).trim();
      const changed=await tx.orderClinicalNote.updateMany({
        where:{id:note.id,organizationId,orderId,status:"ACTIVE"},
        data:{status:"RETRACTED",retiredAt:new Date(),retiredByUserId:actorId,
          retirementReason:reason},
      });
      if(changed.count!==1)throw new ClinicalHandoverError("clinical_note_no_longer_active");
      await tx.auditEvent.create({data:{
        organizationId,branchId:order.branchId,actorUserId:actorId,
        action:"ORDER_CLINICAL_HANDOVER_RETRACTED",entityType:"OrderClinicalNote",
        entityId:note.id,reason,oldValues:{status:"ACTIVE"},
        newValues:{status:"RETRACTED",bodyPreserved:true,orderId,threadId:note.threadId},
        ipAddress:ctx.ipAddress,userAgent:ctx.userAgent,
      }});
      return {id:note.id,action:"RETRACT",replayed:false};
    },{isolationLevel:"Serializable",timeout:45000});
    return NextResponse.json(result,{headers:noStore});
  }catch(error){return failure(error);}
}
