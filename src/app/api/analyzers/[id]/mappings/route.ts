import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { canAccessBranch, requirePermission, requestContext } from "@/lib/auth";
import {
  analyzerMappingIdentityKey,
  analyzerMappingIndependentApprovalError, analyzerMappingReviewerIsLive,
  analyzerMappingUnitConfigurationError,
  planAnalyzerMappingApproval,
  snapshotAnalyzerMappingTargetUnit,
} from "@/lib/analyzer-mapping-governance";
import { prisma } from "@/lib/db";

function text(value: unknown, max = 200) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("analyzers.manage");
  const ctx = await requestContext();
  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const analyzerTestCode = text(body.analyzerTestCode, 120);
  const analyzerUnitCode = text(body.analyzerUnitCode, 80) || null;
  const testId = text(body.testId, 36);
  const componentId = text(body.componentId, 36) || null;
  const effectiveFrom = new Date(String(body.effectiveFrom || ""));
  const effectiveTo = body.effectiveTo ? new Date(String(body.effectiveTo)) : null;

  if (!analyzerTestCode || !testId || Number.isNaN(effectiveFrom.getTime())) {
    return NextResponse.json({ error: "missing_required_fields" }, { status: 400 });
  }
  if (effectiveTo && (Number.isNaN(effectiveTo.getTime()) || effectiveTo < effectiveFrom)) {
    return NextResponse.json({ error: "invalid_effective_dates" }, { status: 400 });
  }

  const analyzer = await prisma.analyzer.findFirst({
    where: { id, organizationId: session.user.organizationId, status: "ACTIVE" },
  });
  if (!analyzer) return NextResponse.json({ error: "analyzer_not_found" }, { status: 404 });
  if (!canAccessBranch(session, analyzer.branchId)) return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });

  const test = await prisma.labTest.findFirst({
    where: { id: testId, organizationId: session.user.organizationId, status: "ACTIVE" },
    include: {
      defaultUnit: true,
      components: { where: { status: "ACTIVE" }, include: { unit: true } },
      calculatedRules: {
        where: {
          status: "ACTIVE",
          effectiveFrom: { lte: effectiveFrom },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: effectiveFrom } }],
        },
      },
    },
  });
  if (!test) return NextResponse.json({ error: "test_not_found" }, { status: 404 });

  const component = componentId ? test.components.find(item => item.id === componentId) || null : null;
  if (componentId && !component) return NextResponse.json({ error: "component_not_found_for_test" }, { status: 409 });
  if (componentId && test.calculatedRules.some(rule => rule.targetComponentId === componentId)) {
    return NextResponse.json({ error: "analyzer_mapping_cannot_target_calculated_component" }, { status: 409 });
  }
  if (test.components.length > 0 && !componentId) {
    return NextResponse.json({ error: "component_required_for_multi_component_test" }, { status: 409 });
  }

  const lisTargetUnit = componentId ? component?.unit || null : test.defaultUnit;
  const unitError = analyzerMappingUnitConfigurationError({ analyzerUnitCode, targetUnit: lisTargetUnit });
  if (unitError) return NextResponse.json({ error: unitError }, { status: 409 });

  const mapping = await prisma.$transaction(async tx => {
    const created = await tx.analyzerTestMapping.create({
      data: {
        analyzerId: analyzer.id,
        analyzerTestCode,
        analyzerUnitCode,
        testId,
        componentId,
        effectiveFrom,
        effectiveTo,
        approvalStatus: "DRAFT",
        status: "INACTIVE",
        createdByUserId: session.user.id,
      },
    });
    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: analyzer.branchId,
        actorUserId: session.user.id,
        action: "ANALYZER_TEST_MAPPING_DRAFT_CREATED",
        entityType: "AnalyzerTestMapping",
        entityId: created.id,
        newValues: { analyzerId: analyzer.id, analyzerTestCode, analyzerUnitCode, testId, componentId, effectiveFrom, effectiveTo, approvalStatus: created.approvalStatus, status: created.status },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
    return created;
  });

  return NextResponse.json({ status: "ok", mapping }, { status: 201 });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("analyzers.mappings.approve");
  const ctx = await requestContext();
  const { id: analyzerId } = await params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const mappingId = text(body.id, 36);
  const action = text(body.action, 20).toUpperCase();
  const reason = text(body.reason, 1000);
  if (!mappingId || !["APPROVE", "RETIRE"].includes(action)) {
    return NextResponse.json({ error: "invalid_analyzer_mapping_governance_action" }, { status: 400 });
  }
  if (action === "RETIRE" && !reason) return NextResponse.json({ error: "retirement_reason_required" }, { status: 400 });

  const existing = await prisma.analyzerTestMapping.findFirst({
    where: { id: mappingId, analyzerId, analyzer: { organizationId: session.user.organizationId } },
    include: { analyzer: true },
  });
  if (!existing) return NextResponse.json({ error: "analyzer_mapping_not_found" }, { status: 404 });
  if (!canAccessBranch(session, existing.analyzer.branchId)) return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });

  const identityHash = createHash("sha256").update(analyzerMappingIdentityKey(existing)).digest("hex");
  const outcome = await prisma.$transaction(async tx => {
    const lockAt = new Date();
    await tx.clinicalRuleGovernanceLock.upsert({
      where: { organizationId_ruleType_identityHash: { organizationId: session.user.organizationId, ruleType: "ANALYZER_TEST_MAPPING", identityHash } },
      create: { organizationId: session.user.organizationId, ruleType: "ANALYZER_TEST_MAPPING", identityHash, updatedAt: lockAt },
      update: { updatedAt: lockAt },
    });

    const locked = await tx.analyzerTestMapping.findFirst({
      where: { id: mappingId, analyzerId, analyzer: { organizationId: session.user.organizationId } },
      include: {
        analyzer: true,
        test: {
          include: {
            defaultUnit: true,
            components: { where: { status: "ACTIVE" }, include: { unit: true } },
            calculatedRules: {
              where: {
                status: "ACTIVE",
                effectiveFrom: { lte: existing.effectiveFrom },
                OR: [{ effectiveTo: null }, { effectiveTo: { gte: existing.effectiveFrom } }],
              },
            },
          },
        },
        component: { include: { unit: true } },
      },
    });
    if (!locked) return { error: "analyzer_mapping_not_found" as const };
    if (!canAccessBranch(session, locked.analyzer.branchId)) return { error: "branch_forbidden" as const };
    // Re-read live permissions and branch membership under the identity lock.
    // getCurrentSession() was evaluated BEFORE this transaction began.
    const reviewerIsLive = await analyzerMappingReviewerIsLive(tx, {
      organizationId: session.user.organizationId,
      branchId: locked.analyzer.branchId,
      userId: session.user.id,
      sessionBranchIds: session.user.branchScopes
        .filter(scope => scope.branch.organizationId === session.user.organizationId &&
          scope.branch.status === "ACTIVE")
        .map(scope => scope.branchId),
    });
    if (!reviewerIsLive) return { error: "analyzer_mapping_live_permission_revoked" as const };

    if (action === "APPROVE") {
      const approvalError = analyzerMappingIndependentApprovalError(locked, session.user.id);
      if (approvalError) return { error: approvalError };
      if (locked.analyzer.status !== "ACTIVE" || locked.test.status !== "ACTIVE") {
        return { error: "analyzer_mapping_target_not_active" as const };
      }
      const component = locked.componentId ? locked.test.components.find(item => item.id === locked.componentId) || null : null;
      if (locked.componentId && !component) return { error: "component_not_active_for_test" as const };
      if (locked.test.components.length > 0 && !locked.componentId) return { error: "component_required_for_multi_component_test" as const };
      if (locked.componentId && locked.test.calculatedRules.some(rule => rule.targetComponentId === locked.componentId)) {
        return { error: "analyzer_mapping_cannot_target_calculated_component" as const };
      }

      const lisTargetUnit = locked.componentId ? component?.unit || null : locked.test.defaultUnit;
      const unitError = analyzerMappingUnitConfigurationError({ analyzerUnitCode: locked.analyzerUnitCode, targetUnit: lisTargetUnit });
      if (unitError) return { error: unitError };

      const approvedMappings = await tx.analyzerTestMapping.findMany({
        where: { analyzerId: locked.analyzerId, analyzerTestCode: locked.analyzerTestCode, approvalStatus: "APPROVED", status: "ACTIVE", id: { not: locked.id } },
      });
      const plan = planAnalyzerMappingApproval(locked, approvedMappings);
      if (plan.conflicts.length > 0) return { error: "approved_analyzer_mapping_overlap" as const, conflictingMappingIds: plan.conflicts };

      const approvedAt = new Date();
      const predecessorEffectiveTo = new Date(locked.effectiveFrom.getTime() - 1);
      for (const predecessorId of plan.predecessorsToClose) {
        const predecessor = approvedMappings.find(item => item.id === predecessorId);
        if (!predecessor) continue;
        await tx.analyzerTestMapping.update({ where: { id: predecessorId }, data: { effectiveTo: predecessorEffectiveTo } });
        await tx.auditEvent.create({
          data: {
            organizationId: session.user.organizationId,
            branchId: locked.analyzer.branchId,
            actorUserId: session.user.id,
            action: "ANALYZER_TEST_MAPPING_SUPERSEDED",
            entityType: "AnalyzerTestMapping",
            entityId: predecessorId,
            oldValues: { effectiveTo: predecessor.effectiveTo },
            newValues: { effectiveTo: predecessorEffectiveTo, supersededByMappingId: locked.id },
            ipAddress: ctx.ipAddress,
            userAgent: ctx.userAgent,
          },
        });
      }

      const updated = await tx.analyzerTestMapping.update({
        where: { id: locked.id },
        data: {
          approvalStatus: "APPROVED",
          status: "ACTIVE",
          approvedByUserId: session.user.id,
          approvedAt,
          ...snapshotAnalyzerMappingTargetUnit(lisTargetUnit),
          retiredByUserId: null,
          retiredAt: null,
          retirementReason: null,
          deactivatedAt: null,
        },
      });
      await tx.auditEvent.create({
        data: {
          organizationId: session.user.organizationId,
          branchId: locked.analyzer.branchId,
          actorUserId: session.user.id,
          action: "ANALYZER_TEST_MAPPING_APPROVED",
          entityType: "AnalyzerTestMapping",
          entityId: locked.id,
          oldValues: { approvalStatus: locked.approvalStatus, status: locked.status },
          newValues: {
            approvalStatus: updated.approvalStatus,
            status: updated.status,
            approvedAt,
            approvedByUserId: session.user.id,
            analyzerTestCode: updated.analyzerTestCode,
            analyzerUnitCode: updated.analyzerUnitCode,
            testId: updated.testId,
            componentId: updated.componentId,
            lisUnitIdSnapshot: updated.lisUnitIdSnapshot,
            lisUnitCodeSnapshot: updated.lisUnitCodeSnapshot,
            lisUnitSymbolSnapshot: updated.lisUnitSymbolSnapshot,
            lisUnitUcumCodeSnapshot: updated.lisUnitUcumCodeSnapshot,
            predecessorsClosed: plan.predecessorsToClose,
          },
          reason: reason || null,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
      });
      return { status: "ok" as const, mapping: updated };
    }

    if (locked.approvalStatus !== "APPROVED" || locked.status !== "ACTIVE") {
      return { error: "only_approved_analyzer_mapping_can_be_retired" as const };
    }
    const retiredAt = new Date();
    const effectiveTo = locked.effectiveFrom <= retiredAt && (locked.effectiveTo === null || locked.effectiveTo > retiredAt) ? retiredAt : locked.effectiveTo;
    const updated = await tx.analyzerTestMapping.update({
      where: { id: locked.id },
      data: { approvalStatus: "RETIRED", status: "INACTIVE", effectiveTo, retiredByUserId: session.user.id, retiredAt, retirementReason: reason, deactivatedAt: retiredAt },
    });
    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: locked.analyzer.branchId,
        actorUserId: session.user.id,
        action: "ANALYZER_TEST_MAPPING_RETIRED",
        entityType: "AnalyzerTestMapping",
        entityId: locked.id,
        oldValues: { approvalStatus: locked.approvalStatus, status: locked.status, effectiveTo: locked.effectiveTo },
        newValues: { approvalStatus: updated.approvalStatus, status: updated.status, effectiveTo, retiredAt, retiredByUserId: session.user.id },
        reason,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
    return { status: "ok" as const, mapping: updated };
  }, { timeout: 30000, isolationLevel: "Serializable" });

  if ("error" in outcome) {
    const status = outcome.error === "analyzer_mapping_not_found" ? 404
      : ["branch_forbidden", "analyzer_mapping_live_permission_revoked",
        "analyzer_mapping_self_approval_forbidden"].includes(outcome.error ?? "") ? 403 : 409;
    return NextResponse.json(outcome, { status });
  }
  return NextResponse.json(outcome);
}
