import { NextResponse } from "next/server";
import { canAccessBranch, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";
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

async function loadRule(type: RuleType, id: string, organizationId: string): Promise<GovernedClinicalRule | null> {
  switch (type) {
    case "CALCULATED_RESULT_RULE": {
      const rule = await prisma.calculatedResultRule.findFirst({ where: { id, organizationId } });
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
      const rule = await prisma.reflexRule.findFirst({ where: { id, organizationId } });
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
      const rule = await prisma.deltaRule.findFirst({ where: { id, organizationId } });
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
      const rule = await prisma.autoverificationPolicy.findFirst({ where: { id, organizationId } });
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
      const rule = await prisma.validationHoldRule.findFirst({ where: { id, organizationId } });
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
      const rule = await prisma.criticalEscalationPolicy.findFirst({ where: { id, organizationId } });
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
      const rule = await prisma.resultValidationPolicy.findFirst({
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

async function loadActiveRules(type: RuleType, organizationId: string): Promise<GovernedClinicalRule[]> {
  switch (type) {
    case "CALCULATED_RESULT_RULE":
      return (await prisma.calculatedResultRule.findMany({ where: { organizationId, status: "ACTIVE" } })).map(rule => ({
        id: rule.id,
        identityKey: ruleIdentity([rule.testId, rule.targetComponentId]),
        effectiveFrom: rule.effectiveFrom,
        effectiveTo: rule.effectiveTo,
        status: rule.status,
        deactivatedAt: rule.deactivatedAt,
      }));
    case "REFLEX_RULE":
      return (await prisma.reflexRule.findMany({ where: { organizationId, status: "ACTIVE" } })).map(rule => ({
        id: rule.id,
        identityKey: ruleIdentity([rule.sourceTestId, rule.sourceComponentId, rule.branchId, rule.targetTestId, rule.operator]),
        effectiveFrom: rule.effectiveFrom,
        effectiveTo: rule.effectiveTo,
        status: rule.status,
        deactivatedAt: rule.deactivatedAt,
      }));
    case "DELTA_RULE":
      return (await prisma.deltaRule.findMany({ where: { organizationId, status: "ACTIVE" } })).map(rule => ({
        id: rule.id,
        identityKey: ruleIdentity([rule.testId, rule.componentId, rule.branchId, rule.methodId]),
        effectiveFrom: rule.effectiveFrom,
        effectiveTo: rule.effectiveTo,
        status: rule.status,
        deactivatedAt: rule.deactivatedAt,
      }));
    case "AUTOVERIFICATION_POLICY":
      return (await prisma.autoverificationPolicy.findMany({ where: { organizationId, status: "ACTIVE" } })).map(rule => ({
        id: rule.id,
        identityKey: ruleIdentity([rule.testId, rule.branchId]),
        effectiveFrom: rule.effectiveFrom,
        effectiveTo: rule.effectiveTo,
        status: rule.status,
        deactivatedAt: rule.deactivatedAt,
      }));
    case "VALIDATION_HOLD_RULE":
      return (await prisma.validationHoldRule.findMany({ where: { organizationId, status: "ACTIVE" } })).map(rule => ({
        id: rule.id,
        identityKey: ruleIdentity([rule.testId, rule.branchId, rule.condition, rule.resultSource]),
        effectiveFrom: rule.effectiveFrom,
        effectiveTo: rule.effectiveTo,
        status: rule.status,
        deactivatedAt: rule.deactivatedAt,
      }));
    case "CRITICAL_ESCALATION_POLICY":
      return (await prisma.criticalEscalationPolicy.findMany({ where: { organizationId, status: "ACTIVE" } })).map(rule => ({
        id: rule.id,
        identityKey: ruleIdentity([rule.testId, rule.branchId]),
        effectiveFrom: rule.effectiveFrom,
        effectiveTo: rule.effectiveTo,
        status: rule.status,
        deactivatedAt: rule.deactivatedAt,
      }));
    case "RESULT_VALIDATION_POLICY":
      return (await prisma.resultValidationPolicy.findMany({ where: { organizationId, status: "ACTIVE" } })).map(rule => ({
        id: rule.id,
        identityKey: ruleIdentity([rule.scope, rule.branchId, rule.departmentId, rule.testId]),
        effectiveFrom: rule.effectiveFrom,
        effectiveTo: rule.effectiveTo,
        status: rule.status,
        deactivatedAt: rule.deactivatedAt,
      }));
  }
}

async function validateCalculatedApproval(id: string, organizationId: string) {
  const rule = await prisma.calculatedResultRule.findFirst({
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
  const existing = await loadRule(type, id, organizationId);
  if (!existing) return NextResponse.json({ error: "clinical_rule_not_found" }, { status: 404 });
  if (existing.authorizationBranchId && !canAccessBranch(session, existing.authorizationBranchId)) {
    return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });
  }

  if (action === "APPROVE") {
    if (clinicalRuleLifecycleState(existing) !== "DRAFT") {
      return NextResponse.json({ error: "clinical_rule_not_draft" }, { status: 409 });
    }

    if (type === "CALCULATED_RESULT_RULE") {
      const formulaValidation = await validateCalculatedApproval(id, organizationId);
      if (!formulaValidation.ok) {
        return NextResponse.json(formulaValidation, { status: 409 });
      }
    }

    const activeRules = await loadActiveRules(type, organizationId);
    const plan = planClinicalRuleApproval(existing, activeRules);
    if (plan.conflicts.length > 0) {
      return NextResponse.json({
        error: "clinical_rule_effective_range_overlap",
        conflictingRuleIds: plan.conflicts,
      }, { status: 409 });
    }

    const approvedAt = new Date();
    const predecessorEffectiveTo = new Date(existing.effectiveFrom.getTime() - 1);
    const typeName = entityType(type);

    await prisma.$transaction(async tx => {
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
          oldValues: { status: existing.status, lifecycle: "DRAFT" },
          newValues: {
            status: "ACTIVE",
            lifecycle: "APPROVED",
            approvedAt,
            ruleType: type,
            predecessorsClosed: plan.predecessorsToClose,
          },
          reason: reason || null,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
      });
    }, { timeout: 30000 });

    return NextResponse.json({
      status: "ok",
      lifecycle: "APPROVED",
      approvedAt,
      predecessorsClosed: plan.predecessorsToClose,
    });
  }

  if (clinicalRuleLifecycleState(existing) !== "APPROVED") {
    return NextResponse.json({ error: "only_approved_clinical_rule_can_be_retired" }, { status: 409 });
  }
  if (!reason) return NextResponse.json({ error: "retirement_reason_required" }, { status: 400 });

  const retiredAt = new Date();
  const effectiveTo = existing.effectiveFrom <= retiredAt
    && (existing.effectiveTo === null || existing.effectiveTo > retiredAt)
      ? retiredAt
      : existing.effectiveTo;
  const typeName = entityType(type);

  await prisma.$transaction(async tx => {
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
          status: existing.status,
          lifecycle: "APPROVED",
          effectiveTo: existing.effectiveTo,
        },
        newValues: {
          status: "INACTIVE",
          lifecycle: "RETIRED",
          effectiveTo,
          retiredAt,
          ruleType: type,
        },
        reason,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
  }, { timeout: 30000 });

  return NextResponse.json({ status: "ok", lifecycle: "RETIRED", retiredAt });
}
