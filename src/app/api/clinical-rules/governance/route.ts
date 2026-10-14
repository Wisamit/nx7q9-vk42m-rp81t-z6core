import { createHash } from "node:crypto";
import type { Prisma } from "../../../../../generated/prisma/client";
import { NextResponse } from "next/server";
import { canAccessBranch, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { clinicalRuleProofResource } from "@/lib/clinical-rule-step-up";
import { validateClinicalRuleApprovalReferences } from "@/lib/clinical-rule-approval-references";
import { consumeStaffStepUp, StaffStepUpError } from "@/lib/staff-step-up";
import {
  clinicalRuleLifecycleState,
  planClinicalRuleApproval,
  ruleIdentity,
  type GovernedClinicalRule,
} from "@/lib/clinical-rule-governance";
import { formulaVariables } from "@/lib/formula-engine";

type RuleType =
  | "CALCULATED_RESULT_RULE"
  | "REFLEX_RULE"
  | "DELTA_RULE"
  | "AUTOVERIFICATION_POLICY"
  | "VALIDATION_HOLD_RULE"
  | "CRITICAL_ESCALATION_POLICY"
  | "RESULT_VALIDATION_POLICY";

type ClinicalRuleDb = Pick<typeof prisma,
  | "calculatedResultRule"
  | "reflexRule"
  | "deltaRule"
  | "autoverificationPolicy"
  | "validationHoldRule"
  | "criticalEscalationPolicy"
  | "resultValidationPolicy"
>;

const ruleTypes = new Set<RuleType>([
  "CALCULATED_RESULT_RULE",
  "REFLEX_RULE",
  "DELTA_RULE",
  "AUTOVERIFICATION_POLICY",
  "VALIDATION_HOLD_RULE",
  "CRITICAL_ESCALATION_POLICY",
  "RESULT_VALIDATION_POLICY",
]);

function text(value: unknown, max = 1000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function ruleType(value: unknown): RuleType | null {
  const normalized = text(value, 80).toUpperCase() as RuleType;
  return ruleTypes.has(normalized) ? normalized : null;
}

function entityType(type: RuleType) {
  return {
    CALCULATED_RESULT_RULE: "CalculatedResultRule",
    REFLEX_RULE: "ReflexRule",
    DELTA_RULE: "DeltaRule",
    AUTOVERIFICATION_POLICY: "AutoverificationPolicy",
    VALIDATION_HOLD_RULE: "ValidationHoldRule",
    CRITICAL_ESCALATION_POLICY: "CriticalEscalationPolicy",
    RESULT_VALIDATION_POLICY: "ResultValidationPolicy",
  }[type];
}

async function loadRule(db: ClinicalRuleDb, type: RuleType, id: string, organizationId: string): Promise<GovernedClinicalRule | null> {
  switch (type) {
    case "CALCULATED_RESULT_RULE": {
      const rule = await db.calculatedResultRule.findFirst({ where: { id, organizationId } });
      return rule ? {
        id: rule.id,
        identityKey: ruleIdentity([rule.testId, rule.targetComponentId]),
        effectiveFrom: rule.effectiveFrom,
        effectiveTo: rule.effectiveTo,
        status: rule.status,
        deactivatedAt: rule.deactivatedAt,
        authorizationBranchId: null,
      } : null;
    }
    case "REFLEX_RULE": {
      const rule = await db.reflexRule.findFirst({ where: { id, organizationId } });
      return rule ? {
        id: rule.id,
        identityKey: ruleIdentity([
          rule.sourceTestId,
          rule.sourceComponentId,
          rule.branchId,
          rule.targetTestId,
          rule.operator,
        ]),
        effectiveFrom: rule.effectiveFrom,
        effectiveTo: rule.effectiveTo,
        status: rule.status,
        deactivatedAt: rule.deactivatedAt,
        authorizationBranchId: rule.branchId,
      } : null;
    }
    case "DELTA_RULE": {
      const rule = await db.deltaRule.findFirst({ where: { id, organizationId } });
      return rule ? {
        id: rule.id,
        identityKey: ruleIdentity([rule.testId, rule.componentId, rule.branchId, rule.methodId]),
        effectiveFrom: rule.effectiveFrom,
        effectiveTo: rule.effectiveTo,
        status: rule.status,
        deactivatedAt: rule.deactivatedAt,
        authorizationBranchId: rule.branchId,
      } : null;
    }
    case "AUTOVERIFICATION_POLICY": {
      const rule = await db.autoverificationPolicy.findFirst({ where: { id, organizationId } });
      return rule ? {
        id: rule.id,
        identityKey: ruleIdentity([rule.testId, rule.branchId]),
        effectiveFrom: rule.effectiveFrom,
        effectiveTo: rule.effectiveTo,
        status: rule.status,
        deactivatedAt: rule.deactivatedAt,
        authorizationBranchId: rule.branchId,
      } : null;
    }
    case "VALIDATION_HOLD_RULE": {
      const rule = await db.validationHoldRule.findFirst({ where: { id, organizationId } });
      return rule ? {
        id: rule.id,
        identityKey: ruleIdentity([rule.testId, rule.branchId, rule.condition, rule.resultSource]),
        effectiveFrom: rule.effectiveFrom,
        effectiveTo: rule.effectiveTo,
        status: rule.status,
        deactivatedAt: rule.deactivatedAt,
        authorizationBranchId: rule.branchId,
      } : null;
    }
    case "CRITICAL_ESCALATION_POLICY": {
      const rule = await db.criticalEscalationPolicy.findFirst({ where: { id, organizationId } });
      return rule ? {
        id: rule.id,
        identityKey: ruleIdentity([rule.testId, rule.branchId]),
        effectiveFrom: rule.effectiveFrom,
        effectiveTo: rule.effectiveTo,
        status: rule.status,
        deactivatedAt: rule.deactivatedAt,
        authorizationBranchId: rule.branchId,
      } : null;
    }
    case "RESULT_VALIDATION_POLICY": {
      const rule = await db.resultValidationPolicy.findFirst({
        where: { id, organizationId },
        include: { department: { select: { branchId: true } } },
      });
      return rule ? {
        id: rule.id,
        identityKey: ruleIdentity([rule.scope, rule.branchId, rule.departmentId, rule.testId]),
        effectiveFrom: rule.effectiveFrom,
        effectiveTo: rule.effectiveTo,
        status: rule.status,
        deactivatedAt: rule.deactivatedAt,
        authorizationBranchId: rule.branchId || rule.department?.branchId || null,
      } : null;
    }
  }
}

async function loadActiveRules(db: ClinicalRuleDb, type: RuleType, organizationId: string): Promise<GovernedClinicalRule[]> {
  switch (type) {
    case "CALCULATED_RESULT_RULE":
      return (await db.calculatedResultRule.findMany({ where: { organizationId, status: "ACTIVE" } })).map(rule => ({
        id: rule.id,
        identityKey: ruleIdentity([rule.testId, rule.targetComponentId]),
        effectiveFrom: rule.effectiveFrom,
        effectiveTo: rule.effectiveTo,
        status: rule.status,
        deactivatedAt: rule.deactivatedAt,
      }));
    case "REFLEX_RULE":
      return (await db.reflexRule.findMany({ where: { organizationId, status: "ACTIVE" } })).map(rule => ({
        id: rule.id,
        identityKey: ruleIdentity([rule.sourceTestId, rule.sourceComponentId, rule.branchId, rule.targetTestId, rule.operator]),
        effectiveFrom: rule.effectiveFrom,
        effectiveTo: rule.effectiveTo,
        status: rule.status,
        deactivatedAt: rule.deactivatedAt,
      }));
    case "DELTA_RULE":
      return (await db.deltaRule.findMany({ where: { organizationId, status: "ACTIVE" } })).map(rule => ({
        id: rule.id,
        identityKey: ruleIdentity([rule.testId, rule.componentId, rule.branchId, rule.methodId]),
        effectiveFrom: rule.effectiveFrom,
        effectiveTo: rule.effectiveTo,
        status: rule.status,
        deactivatedAt: rule.deactivatedAt,
      }));
    case "AUTOVERIFICATION_POLICY":
      return (await db.autoverificationPolicy.findMany({ where: { organizationId, status: "ACTIVE" } })).map(rule => ({
        id: rule.id,
        identityKey: ruleIdentity([rule.testId, rule.branchId]),
        effectiveFrom: rule.effectiveFrom,
        effectiveTo: rule.effectiveTo,
        status: rule.status,
        deactivatedAt: rule.deactivatedAt,
      }));
    case "VALIDATION_HOLD_RULE":
      return (await db.validationHoldRule.findMany({ where: { organizationId, status: "ACTIVE" } })).map(rule => ({
        id: rule.id,
        identityKey: ruleIdentity([rule.testId, rule.branchId, rule.condition, rule.resultSource]),
        effectiveFrom: rule.effectiveFrom,
        effectiveTo: rule.effectiveTo,
        status: rule.status,
        deactivatedAt: rule.deactivatedAt,
      }));
    case "CRITICAL_ESCALATION_POLICY":
      return (await db.criticalEscalationPolicy.findMany({ where: { organizationId, status: "ACTIVE" } })).map(rule => ({
        id: rule.id,
        identityKey: ruleIdentity([rule.testId, rule.branchId]),
        effectiveFrom: rule.effectiveFrom,
        effectiveTo: rule.effectiveTo,
        status: rule.status,
        deactivatedAt: rule.deactivatedAt,
      }));
    case "RESULT_VALIDATION_POLICY":
      return (await db.resultValidationPolicy.findMany({ where: { organizationId, status: "ACTIVE" } })).map(rule => ({
        id: rule.id,
        identityKey: ruleIdentity([rule.scope, rule.branchId, rule.departmentId, rule.testId]),
        effectiveFrom: rule.effectiveFrom,
        effectiveTo: rule.effectiveTo,
        status: rule.status,
        deactivatedAt: rule.deactivatedAt,
      }));
  }
}

async function validateCalculatedApproval(db: ClinicalRuleDb, id: string, organizationId: string) {
  const rule = await db.calculatedResultRule.findFirst({
    where: { id, organizationId },
    include: {
      test: {
        include: {
          components: { where: { status: "ACTIVE" } },
          calculatedRules: { where: { status: "ACTIVE", id: { not: id } } },
        },
      },
    },
  });
  if (!rule) return { ok: false as const, error: "clinical_rule_not_found" };

  let variables: string[];
  try {
    variables = formulaVariables(rule.expression);
  } catch {
    return { ok: false as const, error: "invalid_formula" };
  }

  const componentsByCode = new Map(rule.test.components.map(component => [component.code.toUpperCase(), component]));
  const activeCalculatedTargets = new Set(rule.test.calculatedRules.map(active => active.targetComponentId));
  for (const variable of variables) {
    const component = componentsByCode.get(variable);
    if (!component) return { ok: false as const, error: "formula_component_not_found", componentCode: variable };
    if (activeCalculatedTargets.has(component.id)) {
      return { ok: false as const, error: "calculated_formula_chaining_not_supported", componentCode: variable };
    }
  }

  return { ok: true as const };
}

export async function POST(request: Request) {
  const session = await requirePermission("clinical_rules.approve");
  const ctx = await requestContext();
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const type = ruleType(body.ruleType);
  const id = text(body.id, 36);
  const action = text(body.action, 20).toUpperCase();
  const reason = text(body.reason, 1000);
  if (!type || !id || !["APPROVE", "RETIRE"].includes(action)) {
    return NextResponse.json({ error: "invalid_clinical_rule_governance_request" }, { status: 400 });
  }

  const organizationId = session.user.organizationId;
  const existing = await loadRule(prisma, type, id, organizationId);
  if (!existing) return NextResponse.json({ error: "clinical_rule_not_found" }, { status: 404 });
  if (existing.authorizationBranchId && !canAccessBranch(session, existing.authorizationBranchId)) {
    return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });
  }

  const proofResource = clinicalRuleProofResource(type,id);
  const activeBranchId = session.activeBranchId;
  // Approval is an active-branch, one-time signed operation, not a
  // background tenant-wide mutation originating from another branch.
  if (!proofResource || !activeBranchId ||
      (existing.authorizationBranchId && existing.authorizationBranchId !== activeBranchId)) {
    return NextResponse.json({error:"clinical_rule_active_branch_required"},{status:403});
  }
  const proofToken = request.headers.get("x-staff-step-up-token");
  const ensureCurrentAuthority = async (tx: Prisma.TransactionClient) => {
    const actor = await tx.user.findFirst({where:{
      id:session.user.id,organizationId,status:"ACTIVE",
      roles:{some:{role:{organizationId,status:"ACTIVE",
        permissions:{some:{permission:{code:"clinical_rules.approve"}}}}}},
      branchScopes:{some:{branchId:activeBranchId,branch:{
        organizationId,status:"ACTIVE",
      }}},
    },select:{id:true}});
    if (!actor) return false;
    const liveSession = await tx.userSession.findFirst({
      where:{id:session.id,userId:session.user.id,
        activeBranchId,revokedAt:null,expiresAt:{gt:new Date()}},
      select:{id:true},
    });
    return !!liveSession;
  };
  try {
  if (action === "APPROVE") {
    const identityHash = createHash("sha256").update(existing.identityKey).digest("hex");
    const outcome = await prisma.$transaction(async tx => {
      const lockAt = new Date();
      await tx.clinicalRuleGovernanceLock.upsert({
        where: {
          organizationId_ruleType_identityHash: {
            organizationId,
            ruleType: type,
            identityHash,
          },
        },
        create: { organizationId, ruleType: type, identityHash, updatedAt: lockAt },
        update: { updatedAt: lockAt },
      });

      const lockedExisting = await loadRule(tx, type, id, organizationId);
      if (!lockedExisting) return { error: "clinical_rule_not_found" as const };
      if (lockedExisting.authorizationBranchId && !canAccessBranch(session, lockedExisting.authorizationBranchId)) {
        return { error: "branch_forbidden" as const };
      }
      if (clinicalRuleLifecycleState(lockedExisting) !== "DRAFT") {
        return { error: "clinical_rule_not_draft" as const };
      }

      // Previously valid draft references may have been deactivated or moved
      // to another tenant/department after creation. Resolve every live link
      // under the governance lock before consuming the one-time approval proof.
      const linkValidation = await validateClinicalRuleApprovalReferences(tx, {
        type, id, organizationId, activeBranchId, userId: session.user.id,
        sessionDepartmentIds: session.user.departmentScopes.map(s => s.departmentId),
      });
      if (!linkValidation.ok) return {error:linkValidation.error};

      if (type === "CALCULATED_RESULT_RULE") {
        const formulaValidation = await validateCalculatedApproval(tx, id, organizationId);
        if (!formulaValidation.ok) return formulaValidation;
      }

      const activeRules = await loadActiveRules(tx, type, organizationId);
      const plan = planClinicalRuleApproval(lockedExisting, activeRules);
      if (plan.conflicts.length > 0) {
        return {
          error: "clinical_rule_effective_range_overlap" as const,
          conflictingRuleIds: plan.conflicts,
        };
      }
      if (!await ensureCurrentAuthority(tx)) {
        return {error:"clinical_rule_approver_scope_revoked" as const};
      }
      const stepUp = await consumeStaffStepUp(tx,{
        token:proofToken,action:"CLINICAL_RULE_APPROVE",resourceKey:proofResource,
        sessionId:session.id,userId:session.user.id,organizationId,
        branchId:activeBranchId,ipAddress:ctx.ipAddress,userAgent:ctx.userAgent,
      });

      const approvedAt = new Date();
      const predecessorEffectiveTo = new Date(lockedExisting.effectiveFrom.getTime() - 1);
      const typeName = entityType(type);

      for (const predecessorId of plan.predecessorsToClose) {
        switch (type) {
          case "CALCULATED_RESULT_RULE":
            await tx.calculatedResultRule.update({ where: { id: predecessorId }, data: { effectiveTo: predecessorEffectiveTo } });
            break;
          case "REFLEX_RULE":
            await tx.reflexRule.update({ where: { id: predecessorId }, data: { effectiveTo: predecessorEffectiveTo } });
            break;
          case "DELTA_RULE":
            await tx.deltaRule.update({ where: { id: predecessorId }, data: { effectiveTo: predecessorEffectiveTo } });
            break;
          case "AUTOVERIFICATION_POLICY":
            await tx.autoverificationPolicy.update({ where: { id: predecessorId }, data: { effectiveTo: predecessorEffectiveTo } });
            break;
          case "VALIDATION_HOLD_RULE":
            await tx.validationHoldRule.update({ where: { id: predecessorId }, data: { effectiveTo: predecessorEffectiveTo } });
            break;
          case "CRITICAL_ESCALATION_POLICY":
            await tx.criticalEscalationPolicy.update({ where: { id: predecessorId }, data: { effectiveTo: predecessorEffectiveTo } });
            break;
          case "RESULT_VALIDATION_POLICY":
            await tx.resultValidationPolicy.update({ where: { id: predecessorId }, data: { effectiveTo: predecessorEffectiveTo } });
            break;
        }

        await tx.auditEvent.create({
          data: {
            organizationId,
            branchId: session.activeBranchId,
            actorUserId: session.user.id,
            action: "CLINICAL_RULE_VERSION_SUPERSEDED",
            entityType: typeName,
            entityId: predecessorId,
            newValues: {
              effectiveTo: predecessorEffectiveTo,
              supersededByRuleId: id,
              ruleType: type,
            },
            ipAddress: ctx.ipAddress,
            userAgent: ctx.userAgent,
          },
        });
      }

      switch (type) {
        case "CALCULATED_RESULT_RULE":
          await tx.calculatedResultRule.update({ where: { id }, data: { status: "ACTIVE", deactivatedAt: null } });
          break;
        case "REFLEX_RULE":
          await tx.reflexRule.update({ where: { id }, data: { status: "ACTIVE", deactivatedAt: null } });
          break;
        case "DELTA_RULE":
          await tx.deltaRule.update({ where: { id }, data: { status: "ACTIVE", deactivatedAt: null } });
          break;
        case "AUTOVERIFICATION_POLICY":
          await tx.autoverificationPolicy.update({ where: { id }, data: { status: "ACTIVE", deactivatedAt: null } });
          break;
        case "VALIDATION_HOLD_RULE":
          await tx.validationHoldRule.update({ where: { id }, data: { status: "ACTIVE", deactivatedAt: null } });
          break;
        case "CRITICAL_ESCALATION_POLICY":
          await tx.criticalEscalationPolicy.update({ where: { id }, data: { status: "ACTIVE", deactivatedAt: null } });
          break;
        case "RESULT_VALIDATION_POLICY":
          await tx.resultValidationPolicy.update({ where: { id }, data: { status: "ACTIVE", deactivatedAt: null } });
          break;
      }

      await tx.auditEvent.create({
        data: {
          organizationId,
          branchId: session.activeBranchId,
          actorUserId: session.user.id,
          action: "CLINICAL_RULE_APPROVED",
          entityType: typeName,
          entityId: id,
          oldValues: { status: lockedExisting.status, lifecycle: "DRAFT" },
          newValues: {
            status: "ACTIVE",
            lifecycle: "APPROVED",
            approvedAt,
            ruleType: type,
            predecessorsClosed: plan.predecessorsToClose,
            approvalReferencesRevalidated: true,
            stepUpGrantId:stepUp.grantId,
            stepUpProofMethod:stepUp.proofMethod,
          },
          reason: reason || null,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
      });

      return {
        status: "ok" as const,
        lifecycle: "APPROVED" as const,
        approvedAt,
        predecessorsClosed: plan.predecessorsToClose,
      };
    }, { timeout: 30000, isolationLevel: "Serializable" });

    if ("error" in outcome) {
      const status = outcome.error === "clinical_rule_not_found" ? 404
        : outcome.error === "branch_forbidden" ? 403
          : 409;
      return NextResponse.json(outcome, { status });
    }
    return NextResponse.json(outcome);
  }

  if (!reason) return NextResponse.json({ error: "retirement_reason_required" }, { status: 400 });

  const identityHash = createHash("sha256").update(existing.identityKey).digest("hex");
  const outcome = await prisma.$transaction(async tx => {
    const lockAt = new Date();
    await tx.clinicalRuleGovernanceLock.upsert({
      where: {
        organizationId_ruleType_identityHash: {
          organizationId,
          ruleType: type,
          identityHash,
        },
      },
      create: { organizationId, ruleType: type, identityHash, updatedAt: lockAt },
      update: { updatedAt: lockAt },
    });

    const lockedExisting = await loadRule(tx, type, id, organizationId);
    if (!lockedExisting) return { error: "clinical_rule_not_found" as const };
    if (lockedExisting.authorizationBranchId && !canAccessBranch(session, lockedExisting.authorizationBranchId)) {
      return { error: "branch_forbidden" as const };
    }
    if (clinicalRuleLifecycleState(lockedExisting) !== "APPROVED") {
      return { error: "only_approved_clinical_rule_can_be_retired" as const };
    }

    if (!await ensureCurrentAuthority(tx)) {
      return {error:"clinical_rule_approver_scope_revoked" as const};
    }
    const stepUp = await consumeStaffStepUp(tx,{
      token:proofToken,action:"CLINICAL_RULE_RETIRE",resourceKey:proofResource,
      sessionId:session.id,userId:session.user.id,organizationId,
      branchId:activeBranchId,ipAddress:ctx.ipAddress,userAgent:ctx.userAgent,
    });
    const retiredAt = new Date();
    const effectiveTo = lockedExisting.effectiveFrom <= retiredAt
      && (lockedExisting.effectiveTo === null || lockedExisting.effectiveTo > retiredAt)
        ? retiredAt
        : lockedExisting.effectiveTo;
    const typeName = entityType(type);

    switch (type) {
      case "CALCULATED_RESULT_RULE":
        await tx.calculatedResultRule.update({ where: { id }, data: { status: "INACTIVE", deactivatedAt: retiredAt, effectiveTo } });
        break;
      case "REFLEX_RULE":
        await tx.reflexRule.update({ where: { id }, data: { status: "INACTIVE", deactivatedAt: retiredAt, effectiveTo } });
        break;
      case "DELTA_RULE":
        await tx.deltaRule.update({ where: { id }, data: { status: "INACTIVE", deactivatedAt: retiredAt, effectiveTo } });
        break;
      case "AUTOVERIFICATION_POLICY":
        await tx.autoverificationPolicy.update({ where: { id }, data: { status: "INACTIVE", deactivatedAt: retiredAt, effectiveTo } });
        break;
      case "VALIDATION_HOLD_RULE":
        await tx.validationHoldRule.update({ where: { id }, data: { status: "INACTIVE", deactivatedAt: retiredAt, effectiveTo } });
        break;
      case "CRITICAL_ESCALATION_POLICY":
        await tx.criticalEscalationPolicy.update({ where: { id }, data: { status: "INACTIVE", deactivatedAt: retiredAt, effectiveTo } });
        break;
      case "RESULT_VALIDATION_POLICY":
        await tx.resultValidationPolicy.update({ where: { id }, data: { status: "INACTIVE", deactivatedAt: retiredAt, effectiveTo } });
        break;
    }

    await tx.auditEvent.create({
      data: {
        organizationId,
        branchId: session.activeBranchId,
        actorUserId: session.user.id,
        action: "CLINICAL_RULE_RETIRED",
        entityType: typeName,
        entityId: id,
        oldValues: {
          status: lockedExisting.status,
          lifecycle: "APPROVED",
          effectiveTo: lockedExisting.effectiveTo,
        },
        newValues: {
          status: "INACTIVE",
          lifecycle: "RETIRED",
          effectiveTo,
          retiredAt,
          ruleType: type,
          stepUpGrantId:stepUp.grantId,
          stepUpProofMethod:stepUp.proofMethod,
        },
        reason,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });

    return { status: "ok" as const, lifecycle: "RETIRED" as const, retiredAt };
  }, { timeout: 30000 });

  if ("error" in outcome) {
    const status = outcome.error === "clinical_rule_not_found" ? 404
      : outcome.error === "branch_forbidden" ? 403
        : 409;
    return NextResponse.json(outcome, { status });
  }
  return NextResponse.json(outcome);
  } catch (error) {
    if (error instanceof StaffStepUpError) {
      return NextResponse.json({error:error.code},
        {status:error.statusCode,headers:{"Cache-Control":"private, no-store"}});
    }
    throw error;
  }
}
