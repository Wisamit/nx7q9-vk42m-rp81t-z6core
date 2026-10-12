import { Prisma } from "../../../../../generated/prisma/client";
import { NextResponse } from "next/server";
import { getCurrentSession, permissionSet, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  EqaWorkflowError, eqaAllReviewed, eqaAssessment, eqaCode, eqaDueAt,
  eqaId, eqaIndependentReviewer, eqaNextState, eqaOptionalId, eqaReason,
  eqaText, type EqaAction,
} from "@/lib/eqa-workflow";

const actionPermissions: Record<EqaAction, string> = {
  CREATE_PROGRAM: "qc.manage",
  CREATE_ROUND: "qc.enter",
  ADD_OBSERVATION: "qc.enter",
  REMOVE_OBSERVATION: "qc.enter",
  SUBMIT_ROUND: "qc.enter",
  ASSESS_OBSERVATION: "qc.resolve",
  FINALIZE_REVIEW: "qc.resolve",
  CLOSE_ROUND: "qc.resolve",
  DEACTIVATE_PROGRAM: "qc.manage",
};
const actionNames = Object.keys(actionPermissions) as EqaAction[];

export async function POST(request: Request) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const organizationId = session.user.organizationId;
  const activeBranchId = session.activeBranchId;
  if (!activeBranchId || !session.user.branchScopes.some(scope =>
    scope.branchId === activeBranchId &&
    scope.branch.organizationId === organizationId && scope.branch.status === "ACTIVE")) {
    return NextResponse.json({ error: "active_branch_scope_required" }, { status: 403 });
  }
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json"))
    return NextResponse.json({ error: "json_required" }, { status: 415 });
  const raw = await request.text();
  if (Buffer.byteLength(raw,"utf8") > 64 * 1024)
    return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
  let data: unknown;
  try { data = JSON.parse(raw); } catch { data = null; }
  if (!data || typeof data !== "object" || Array.isArray(data))
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  const body = data as Record<string, unknown>;
  const action = body.action;
  if (typeof action !== "string" || !actionNames.includes(action as EqaAction))
    return NextResponse.json({ error: "unknown_action" }, { status: 400 });
  const selectedAction = action as EqaAction;
  if (!permissionSet(session).has(actionPermissions[selectedAction]))
    return NextResponse.json({ error: "permission_denied" }, { status: 403 });
  const ctx = await requestContext();
  const actorUserId = session.user.id;
  try {
    const result = await prisma.$transaction(async tx => {
      const organization = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM organizations WHERE id = ${organizationId} AND status='ACTIVE' FOR UPDATE
      `;
      if (organization.length !== 1) throw new EqaWorkflowError("organization_inactive",403);
      const activeBranch = await tx.branch.findFirst({
        where: { id: activeBranchId, organizationId, status:"ACTIVE" }, select:{id:true},
      });
      const activeGrant = await tx.userBranchScope.findUnique({
        where: { userId_branchId: { userId:actorUserId,branchId:activeBranchId } },
        select:{branchId:true},
      });
      if (!activeBranch || !activeGrant) throw new EqaWorkflowError("active_branch_scope_required",403);
      async function requireBranch(branchId:string) {
        const [branch,scope]=await Promise.all([
          tx.branch.findFirst({where:{id:branchId,organizationId,status:"ACTIVE"},select:{id:true}}),
          tx.userBranchScope.findUnique({
            where:{userId_branchId:{userId:actorUserId,branchId}},select:{branchId:true},
          }),
        ]);
        if (!branch || !scope) throw new EqaWorkflowError("branch_forbidden",403);
      }
      async function audit(
        event:string,entityType:string,entityId:string,branchId:string,
        oldValues:Prisma.InputJsonObject|null,
        newValues:Prisma.InputJsonObject|null,
        reason:string|null = null,
      ) {
        await tx.auditEvent.create({data:{
          organizationId,branchId,actorUserId,action:event,entityType,entityId,
          oldValues:oldValues || undefined,newValues:newValues || undefined,
          reason,ipAddress:ctx.ipAddress,userAgent:ctx.userAgent,
        }});
      }
      if (selectedAction === "CREATE_PROGRAM") {
        const branchId=eqaId(body.branchId,"branch_id");
        await requireBranch(branchId);
        const code=eqaCode(body.code);
        const providerName=eqaText(body.providerName,220,true,"provider_name")!;
        const nameEn=eqaText(body.nameEn,220,true,"name_en")!;
        const nameAr=eqaText(body.nameAr,220,false,"name_ar");
        const program=await tx.eqaProgram.create({data:{
          organizationId,branchId,code,providerName,nameEn,nameAr,createdByUserId:actorUserId,
        }});
        await audit("EQA_PROGRAM_CREATED","EqaProgram",program.id,branchId,null,
          {code,providerName,nameEn,nameAr,status:"ACTIVE"});
        return {programId:program.id,status:program.status};
      }
      // Every remaining operation is serialized against its program/round.
      // The locked organization root also fences program/round creation.
      const programId = selectedAction === "CREATE_ROUND" ||
        selectedAction === "DEACTIVATE_PROGRAM"
        ? eqaId(body.programId,"program_id") : null;
      const roundId = programId === null ? eqaId(body.roundId,"round_id") : null;
      const foundRound = roundId ? await tx.eqaRound.findUnique({
        where:{id:roundId},select:{programId:true},
      }) : null;
      const selectedProgramId=programId ?? foundRound?.programId;
      if (!selectedProgramId) throw new EqaWorkflowError("eqa_round_not_found",404);
      const lockProgram=await tx.$queryRaw<Array<{id:string}>>`
        SELECT id FROM eqa_programs WHERE id = ${selectedProgramId}
        AND organization_id = ${organizationId} FOR UPDATE
      `;
      if (lockProgram.length !== 1) throw new EqaWorkflowError("eqa_program_not_found",404);
      const program=await tx.eqaProgram.findUniqueOrThrow({
        where:{id:selectedProgramId},
      });
      await requireBranch(program.branchId);
      if (selectedAction === "DEACTIVATE_PROGRAM") {
        if (program.status !== "ACTIVE") throw new EqaWorkflowError("program_already_inactive",409);
        const unfinished=await tx.eqaRound.count({
          where:{programId:program.id,status:{not:"CLOSED"}},
        });
        if (unfinished) throw new EqaWorkflowError("program_has_unfinished_rounds",409);
        const reason=eqaReason(body.reason);
        await tx.eqaProgram.update({where:{id:program.id},data:{status:"INACTIVE"}});
        await audit("EQA_PROGRAM_DEACTIVATED","EqaProgram",program.id,program.branchId,
          {status:"ACTIVE"},{status:"INACTIVE"},reason);
        return {programId:program.id,status:"INACTIVE"};
      }
      if (selectedAction === "CREATE_ROUND") {
        if (program.status !== "ACTIVE") throw new EqaWorkflowError("program_inactive",409);
        const roundCode=eqaCode(body.roundCode,"round_code");
        const sampleCode=eqaText(body.sampleCode,120,true,"sample_code")!;
        const dueAt=eqaDueAt(body.dueAt);
        const round=await tx.eqaRound.create({data:{
          programId:program.id,roundCode,sampleCode,dueAt,
          createdByUserId:actorUserId,
        }});
        await audit("EQA_ROUND_CREATED","EqaRound",round.id,program.branchId,null,
          {programId:program.id,roundCode,sampleCode,dueAt:dueAt?.toISOString() ?? null,status:"OPEN"});
        return {roundId:round.id,status:"OPEN"};
      }
      const lockedRound=await tx.$queryRaw<Array<{id:string}>>`
        SELECT id FROM eqa_rounds WHERE id = ${roundId}
        AND program_id = ${program.id} FOR UPDATE
      `;
      if (lockedRound.length !== 1) throw new EqaWorkflowError("eqa_round_not_found",404);
      const round=await tx.eqaRound.findUniqueOrThrow({
        where:{id:roundId!},include:{observations:true},
      });
      if (selectedAction === "ADD_OBSERVATION") {
        if (round.status !== "OPEN" || program.status !== "ACTIVE")
          throw new EqaWorkflowError("eqa_submission_locked",409);
        const entryCode=eqaCode(body.entryCode,"entry_code");
        const componentId=eqaId(body.componentId,"component_id");
        const analyzerId=eqaOptionalId(body.analyzerId,"analyzer_id");
        const observedValue=eqaText(body.observedValue,300,true,"observed_value")!;
        const methodSnapshot=eqaText(body.methodSnapshot,220,false,"method_snapshot");
        const note=eqaText(body.note,1000,false,"note");
        const departmentIds=session.user.departmentScopes
          .filter(scope=>scope.department.status==="ACTIVE" &&
            scope.department.organizationId===organizationId)
          .map(scope=>scope.departmentId);
        const component=await tx.testComponent.findFirst({
          where:{id:componentId,status:"ACTIVE",test:{organizationId,status:"ACTIVE",
            ...(departmentIds.length?{departmentId:{in:departmentIds}}:{})}},
          include:{unit:true,test:{select:{code:true}}},
        });
        if (!component) throw new EqaWorkflowError("component_not_active_or_foreign",403);
        const analyzer=analyzerId ? await tx.analyzer.findFirst({
          where:{id:analyzerId,organizationId,branchId:program.branchId,status:"ACTIVE"},
          select:{id:true,code:true},
        }) : null;
        if (analyzerId && !analyzer) throw new EqaWorkflowError("analyzer_branch_or_status_invalid",403);
        const observation=await tx.eqaObservation.create({data:{
          roundId:round.id,entryCode,componentId,analyzerId,
          componentCodeSnapshot:component.code,
          componentNameEnSnapshot:component.nameEn,
          componentNameArSnapshot:component.nameAr,
          unitSnapshot:component.unit?.symbol ?? null,
          analyzerCodeSnapshot:analyzer?.code ?? null,
          observedValue,methodSnapshot,note,createdByUserId:actorUserId,
        }});
        await audit("EQA_OBSERVATION_RECORDED","EqaObservation",observation.id,program.branchId,
          null,{roundId:round.id,entryCode,componentId,
            componentCodeSnapshot:component.code,analyzerId,observedValue,
            unitSnapshot:component.unit?.symbol ?? null});
        return {observationId:observation.id,status:"OPEN"};
      }
      if (selectedAction === "REMOVE_OBSERVATION") {
        if (round.status !== "OPEN") throw new EqaWorkflowError("eqa_submission_locked",409);
        const observationId=eqaId(body.observationId,"observation_id");
        const observation=round.observations.find(item=>item.id===observationId);
        if (!observation) throw new EqaWorkflowError("observation_not_found",404);
        if (observation.createdByUserId !== actorUserId &&
          !permissionSet(session).has("qc.manage"))
          throw new EqaWorkflowError("observation_creator_or_manager_required",403);
        const reason=eqaReason(body.reason);
        await tx.eqaObservation.delete({where:{id:observationId}});
        await audit("EQA_OPEN_OBSERVATION_REMOVED","EqaObservation",observationId,program.branchId,
          {roundId:round.id,entryCode:observation.entryCode,
            observedValue:observation.observedValue,componentId:observation.componentId},
          null,reason);
        return {removed:observationId};
      }
      if (selectedAction === "SUBMIT_ROUND") {
        if (eqaNextState(round.status,selectedAction) !== "SUBMITTED")
          throw new EqaWorkflowError("eqa_round_state_conflict",409);
        if (!round.observations.length) throw new EqaWorkflowError("eqa_round_empty",409);
        const reason=eqaReason(body.reason);
        await tx.eqaRound.update({where:{id:round.id},data:{
          status:"SUBMITTED",submittedByUserId:actorUserId,submittedAt:new Date(),
        }});
        await audit("EQA_ROUND_SUBMITTED","EqaRound",round.id,program.branchId,
          {status:"OPEN"},{status:"SUBMITTED",count:round.observations.length,
            submittedBy:actorUserId,entries:round.observations.map(o=>({
              id:o.id,entryCode:o.entryCode,componentCode:o.componentCodeSnapshot,
              observedValue:o.observedValue,unit:o.unitSnapshot,
            }))},reason);
        return {roundId:round.id,status:"SUBMITTED"};
      }
      if (selectedAction === "ASSESS_OBSERVATION") {
        if (round.status !== "SUBMITTED" ||
          (round.reviewedByUserId && round.reviewedByUserId !== actorUserId))
          throw new EqaWorkflowError("eqa_review_state_conflict",409);
        const observationId=eqaId(body.observationId,"observation_id");
        const observation=round.observations.find(o=>o.id===observationId);
        if (!observation) throw new EqaWorkflowError("observation_not_found",404);
        if (!eqaIndependentReviewer(actorUserId,round.submittedByUserId,observation.createdByUserId))
          throw new EqaWorkflowError("independent_eqa_reviewer_required",403);
        if (observation.assessment !== null)
          throw new EqaWorkflowError("eqa_assessment_immutable",409);
        const assessment=eqaAssessment(body.assessment);
        const providerExpectedValue=eqaText(body.providerExpectedValue,300,false,"provider_expected_value");
        const providerFeedback=eqaText(body.providerFeedback,1000,false,"provider_feedback");
        const reason=eqaReason(body.reason);
        const now=new Date();
        await tx.eqaObservation.update({where:{id:observation.id},data:{
          assessment,providerExpectedValue,providerFeedback,
          assessedByUserId:actorUserId,assessedAt:now,
        }});
        if (!round.reviewedByUserId) await tx.eqaRound.update({
          where:{id:round.id},data:{reviewedByUserId:actorUserId},
        });
        await audit("EQA_EXTERNAL_ASSESSMENT_RECORDED","EqaObservation",observation.id,
          program.branchId,{assessment:null},
          {roundId:round.id,assessment,providerExpectedValue,providerFeedback,
            observedValue:observation.observedValue,reviewer:actorUserId},reason);
        return {observationId:observation.id,assessment};
      }
      if (selectedAction === "FINALIZE_REVIEW") {
        if (eqaNextState(round.status,selectedAction) !== "ASSESSED" ||
          round.reviewedByUserId !== actorUserId ||
          !eqaIndependentReviewer(actorUserId,round.submittedByUserId) ||
          !eqaAllReviewed(round.observations))
          throw new EqaWorkflowError("eqa_review_incomplete_or_not_independent",409);
        const reason=eqaReason(body.reason);
        await tx.eqaRound.update({where:{id:round.id},data:{
          status:"ASSESSED",reviewedAt:new Date(),reviewReason:reason,
        }});
        await audit("EQA_ROUND_INDEPENDENTLY_REVIEWED","EqaRound",round.id,program.branchId,
          {status:"SUBMITTED"},{status:"ASSESSED",reviewedBy:actorUserId,
            assessments:round.observations.map(o=>({entryCode:o.entryCode,assessment:o.assessment}))},reason);
        return {roundId:round.id,status:"ASSESSED"};
      }
      if (selectedAction === "CLOSE_ROUND") {
        if (eqaNextState(round.status,selectedAction) !== "CLOSED")
          throw new EqaWorkflowError("eqa_round_state_conflict",409);
        const reason=eqaReason(body.reason);
        await tx.eqaRound.update({where:{id:round.id},data:{
          status:"CLOSED",closedAt:new Date(),closedByUserId:actorUserId,
        }});
        await audit("EQA_ROUND_CLOSED","EqaRound",round.id,program.branchId,
          {status:"ASSESSED"},{status:"CLOSED",closedBy:actorUserId,
            unsatisfactoryCount:round.observations.filter(o=>o.assessment==="UNSATISFACTORY").length},
          reason);
        return {roundId:round.id,status:"CLOSED"};
      }
      throw new EqaWorkflowError("unsupported_action");
    },{isolationLevel:"Serializable",timeout:45000});
    return NextResponse.json({status:"ok",...result},
      {headers:{"Cache-Control":"private, no-store"}});
  } catch (error) {
    if (error instanceof EqaWorkflowError)
      return NextResponse.json({error:error.code},{status:error.statusCode});
    return NextResponse.json({error:"eqa_conflict_or_invalid_reference"},{status:409});
  }
}
