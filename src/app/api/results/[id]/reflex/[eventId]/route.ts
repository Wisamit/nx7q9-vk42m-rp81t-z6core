import { NextResponse } from "next/server";
import { canAccessBranch, canAccessDepartment, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Prisma } from "../../../../../../../generated/prisma/client";
import { isClinicalUuid } from "@/lib/order-clinical-handover";
import { reflexOrderEvidenceError } from "@/lib/reflex-order-confirmation";

function text(value: unknown, max = 1000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string; eventId: string }> }) {
  const session = await requirePermission("reflex.review");
  const ctx = await requestContext();
  const { id, eventId } = await params;
  const body = await request.json().catch(() => null) as { action?: string; note?: string; targetOrderItemId?: string; invoiceLineId?: string; billingAcknowledged?: boolean } | null;

  const confirming = body?.action === "CONFIRM_ORDERED";
  const action = body?.action === "ACKNOWLEDGE" || confirming ? "ACKNOWLEDGED" : body?.action === "DISMISS" ? "DISMISSED" : null;
  if (!action) return NextResponse.json({ error: "invalid_action" }, { status: 400 });

  if (typeof body?.note !== "string" || body.note.trim().length < 10 || body.note.trim().length > 1000) return NextResponse.json({error:"reflex_clinical_reason_required"},{status:400});
  if (confirming && (!isClinicalUuid(body?.targetOrderItemId) || !isClinicalUuid(body?.invoiceLineId) || body?.billingAcknowledged !== true)) return NextResponse.json({error:"reflex_order_invoice_confirmation_required"},{status:400});
  if (!confirming && (body?.targetOrderItemId !== undefined || body?.invoiceLineId !== undefined || body?.billingAcknowledged !== undefined)) return NextResponse.json({error:"unexpected_reflex_order_evidence"},{status:400});

  const event = await prisma.reflexRuleEvent.findFirst({
    where: { id: eventId, resultId: id, result: { organizationId: session.user.organizationId } },
    include: {
      result: { include: { orderItem: { include: { order: true, test: { select: { departmentId: true } } } } } },
      rule: { include: { targetTest: true } },
    },
  });
  if (!event) return NextResponse.json({ error: "reflex_event_not_found" }, { status: 404 });
  if (!canAccessBranch(session, event.result.performingBranchId)) {
    return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });
  }
  if (!canAccessDepartment(session, event.result.orderItem.test.departmentId)) {
    return NextResponse.json({ error: "department_forbidden" }, { status: 403 });
  }
  const orderingBranchId = event.result.orderItem.order.orderingBranchId;
  if (confirming && !canAccessBranch(session, orderingBranchId)) return NextResponse.json({error:"reflex_order_branch_forbidden"},{status:403});
  if (confirming && !canAccessDepartment(session, event.rule.targetTest.departmentId)) return NextResponse.json({error:"reflex_target_department_forbidden"},{status:403});
  if (event.status !== "PENDING") {
    return NextResponse.json({ error: "reflex_event_not_pending", status: event.status }, { status: 409 });
  }

  const reviewedAt = new Date();
  const note = text(body?.note);
  const sourceBranchId=event.result.performingBranchId;

  const outcome = await prisma.$transaction(async tx => {
    const lockedSource = await tx.$queryRawUnsafe<Array<{id:string;updated_at:Date;status:string}>>(
      "SELECT id,updated_at,status FROM laboratory_results WHERE id=? AND organization_id=? FOR UPDATE",
      event.resultId,session.user.organizationId);
    if(lockedSource.length!==1||lockedSource[0].updated_at.getTime()!==event.result.updatedAt.getTime()
      ||!["DRAFT","ENTERED"].includes(lockedSource[0].status))
      return {error:"reflex_source_result_changed",httpStatus:409} as const;
    // The event status and permissions MUST be rechecked inside the mutation
    // transaction. The initial snapshot is only a UX preflight.
    const liveActor=await tx.user.findFirst({where:{
      id:session.user.id,organizationId:session.user.organizationId,status:"ACTIVE",
      roles:{some:{role:{organizationId:session.user.organizationId,status:"ACTIVE",
        permissions:{some:{permission:{code:"reflex.review"}}}}}},
      branchScopes:{some:{branchId:event.result.performingBranchId,branch:{
        organizationId:session.user.organizationId,status:"ACTIVE",
      }}},
    },select:{id:true}});
    if(!liveActor) return {error:"reflex_authority_revoked",httpStatus:403} as const;
    const liveDepartmentGrants=await tx.userDepartmentScope.findMany({
      where:{userId:session.user.id},select:{departmentId:true},
    });
    const departmentId=event.result.orderItem.test.departmentId;
    const liveDepartmentIds=liveDepartmentGrants.map(grant=>grant.departmentId);
    if(departmentId && liveDepartmentIds.length>0 &&
       !liveDepartmentIds.includes(departmentId))
      return {error:"reflex_department_scope_changed",httpStatus:403} as const;
    if(session.user.departmentScopes.length>0 && departmentId &&
       !liveDepartmentIds.includes(departmentId))
      return {error:"reflex_department_scope_revoked",httpStatus:403} as const;

    let linkedItemId:string|null=null;
    let billingEvidence:Prisma.InputJsonValue|undefined;
    if(confirming){
      const branchGrant=await tx.userBranchScope.findUnique({where:{
        userId_branchId:{userId:session.user.id,branchId:orderingBranchId}
      },select:{branch:{select:{status:true,organizationId:true}}}});
      if(!branchGrant||branchGrant.branch.status!=="ACTIVE"||
         branchGrant.branch.organizationId!==session.user.organizationId)
        return {error:"reflex_order_branch_scope_revoked",httpStatus:403} as const;
      const targetDept=event.rule.targetTest.departmentId;
      if(targetDept && (liveDepartmentIds.length>0 || session.user.departmentScopes.length>0)
        && (!liveDepartmentIds.includes(targetDept)
          ||(session.user.departmentScopes.length>0&&!session.user.departmentScopes.includes(targetDept))))
        return {error:"reflex_target_department_scope_revoked",httpStatus:403} as const;
      const candidate=await tx.orderItem.findFirst({
        where:{id:body?.targetOrderItemId,order:{organizationId:session.user.organizationId}},
        include:{order:true,specimenLinks:{where:{status:"ACTIVE"},include:{specimen:true}}},
      });
      const invoiceLine=candidate?await tx.invoiceLine.findFirst({
        where:{id:body?.invoiceLineId,orderItemId:candidate.id,
          invoice:{organizationId:session.user.organizationId}},
        include:{invoice:true},
      }):null;
      if(!candidate||!invoiceLine)
        return {error:"reflex_order_invoice_evidence_missing",httpStatus:409} as const;
      const lockedInvoice=await tx.$queryRawUnsafe<Array<{id:string}>>(
        "SELECT id FROM invoices WHERE id=? AND organization_id=? FOR UPDATE",
        invoiceLine.invoiceId,session.user.organizationId);
      if(lockedInvoice.length!==1)
        return {error:"reflex_invoice_changed",httpStatus:409} as const;
      const liveLine=await tx.invoiceLine.findUnique({
        where:{id:invoiceLine.id},include:{invoice:true}});
      if(!liveLine) return {error:"reflex_invoice_changed",httpStatus:409} as const;
      const evidenceError=reflexOrderEvidenceError({
        organizationId:session.user.organizationId,
        sameOrganization:candidate.order.organizationId===session.user.organizationId
          &&liveLine.invoice.organizationId===session.user.organizationId,
        sourcePatientId:event.result.orderItem.order.patientId,
        targetPatientId:candidate.order.patientId,
        sourceOrderingBranchId:orderingBranchId,
        targetOrderingBranchId:candidate.order.orderingBranchId,
        sourceOrderId:event.result.orderItem.orderId,
        targetOrderId:candidate.orderId,
        targetItemId:candidate.id,
        targetTestId:candidate.testId,ruleTargetTestId:event.rule.targetTestId,
        targetItemStatus:candidate.status,targetOrderStatus:candidate.order.status,
        targetItemCreatedAt:candidate.createdAt,reflexDetectedAt:event.createdAt,
        invoiceStatus:liveLine.invoice.status,invoiceOrderId:liveLine.invoice.orderId,
        invoiceCurrency:liveLine.invoice.currency,invoiceLineOrderItemId:liveLine.orderItemId,
        invoiceLineTotal:liveLine.lineTotal.toFixed(4),
        targetItemFinalPrice:candidate.finalPriceSnapshot.toFixed(4),
        targetItemCurrency:candidate.currency,invoiceLineQuantity:liveLine.quantity.toFixed(3),
        specimenRequirementConfigured:Boolean(event.rule.targetTest.specimenTypeId),
        activeSpecimens:candidate.specimenLinks.map(link=>({
          specimenOrganizationId:link.specimen.organizationId,
          specimenOrderId:link.specimen.orderId,
          specimenTypeId:link.specimen.specimenTypeId,
          requiredSpecimenTypeId:event.rule.targetTest.specimenTypeId,
          specimenStatus:link.specimen.status,
          currentBranchId:link.specimen.currentBranchId,
        })),
        explicitBillingAcknowledgement:body?.billingAcknowledged===true,
      });
      if(evidenceError)return {error:evidenceError,httpStatus:409} as const;
      linkedItemId=candidate.id;
      billingEvidence={
        invoiceId:liveLine.invoiceId,invoiceLineId:liveLine.id,
        invoiceNumber:liveLine.invoice.invoiceNumber,
        invoiceStatusAtConfirmation:liveLine.invoice.status,
        targetOrderId:candidate.orderId,targetOrderItemId:candidate.id,
        targetTestId:candidate.testId,
        lineTotal:liveLine.lineTotal.toFixed(4),currency:liveLine.invoice.currency,
        specimenIds:candidate.specimenLinks.map(link=>link.specimenId),
        confirmedAt:reviewedAt.toISOString(),noAutoOrderOrCharge:true,
      };
    }

    // Conditional one-winner claim prevents two simultaneous reviewers
    // from overwriting the action, reviewer or audit history.
    const claimed = await tx.reflexRuleEvent.updateMany({
      where: {id:event.id,resultId:id,status:"PENDING",updatedAt:event.updatedAt,triggerValueSnapshot:event.triggerValueSnapshot,
        result:{organizationId:session.user.organizationId,
          performingBranchId:event.result.performingBranchId}},
      data: {
        status:action,reviewedByUserId:session.user.id,
        reviewedAt,reviewNote:note||null,
        confirmedOrderItemId:linkedItemId,
        billingEvidenceSnapshot:billingEvidence??Prisma.DbNull,
      },
    });
    if(claimed.count!==1)
      return {error:"reflex_event_changed_since_review",httpStatus:409} as const;
    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: event.result.performingBranchId,
        actorUserId: session.user.id,
        action: confirming ? "REFLEX_ORDER_CONFIRMED" : action === "ACKNOWLEDGED" ? "REFLEX_RECOMMENDATION_ACKNOWLEDGED" : "REFLEX_RECOMMENDATION_DISMISSED",
        entityType: "ReflexRuleEvent",
        entityId: event.id,
        oldValues: { status: "PENDING" },
        newValues: {
          status: action,
          resultId: event.resultId,
          targetTestId: event.rule.targetTestId,
          targetTestCode: event.rule.targetTest.code,
          reviewedAt,confirmedOrderItemId:linkedItemId,billingEvidence:billingEvidence??null,
        },
        reason: note || null,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
    return {status:"ok" as const,reflexStatus:action,confirmedOrderItemId:linkedItemId};
  },{isolationLevel:"ReadCommitted",timeout:30000});
  if("error" in outcome && typeof outcome.error==="string")
    return NextResponse.json({error:outcome.error},
      {status:outcome.httpStatus,headers:{"Cache-Control":"private, no-store"}});
  return NextResponse.json(outcome,{headers:{"Cache-Control":"private, no-store"}});

}
