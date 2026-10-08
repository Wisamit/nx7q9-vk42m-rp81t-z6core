import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "../../../../../generated/prisma/client";
import { canAccessBranch, getCurrentSession, permissionSet, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { planTatPolicyApproval } from "@/lib/tat-policy-governance";

function id(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 36) : null;
}

function integer(value: unknown) {
  if (value === "" || value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : undefined;
}

function permissionCode(value: unknown) {
  if (value === "" || value === null || value === undefined) return null;
  if (typeof value !== "string") return undefined;
  const code = value.trim().slice(0, 120);
  return code && /^[a-z0-9._-]+$/i.test(code) ? code : undefined;
}

export async function POST(request: NextRequest) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!permissionSet(session).has("catalog.manage")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const ctx = await requestContext();
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const testId = id(body.testId) || "";
  const branchId = id(body.branchId);
  const priority =
    body.priority === "ROUTINE" || body.priority === "URGENT" || body.priority === "STAT"
      ? body.priority
      : body.priority === "" || body.priority === null || body.priority === undefined || body.priority === "ANY"
        ? null
        : undefined;
  const tatMinutes = integer(body.tatMinutes);
  const alertBeforeMinutes = integer(body.alertBeforeMinutes);
  const escalationAfterMinutes = integer(body.escalationAfterMinutes);
  const escalationRepeatMinutes = integer(body.escalationRepeatMinutes);
  const maxEscalationLevelRaw = integer(body.maxEscalationLevel);
  const maxEscalationLevel = maxEscalationLevelRaw === null ? 1 : maxEscalationLevelRaw;
  const escalationPermissionCode = permissionCode(body.escalationPermissionCode);

  if (priority === undefined) {
    return NextResponse.json({ error: "invalid_priority" }, { status: 400 });
  }
  if (tatMinutes === null || tatMinutes === undefined || tatMinutes < 0 || tatMinutes > 5_256_000) {
    return NextResponse.json({ error: "invalid_tat_minutes" }, { status: 400 });
  }
  if (
    alertBeforeMinutes === undefined ||
    (alertBeforeMinutes !== null && (alertBeforeMinutes < 0 || alertBeforeMinutes > tatMinutes))
  ) {
    return NextResponse.json({ error: "invalid_alert_before_minutes" }, { status: 400 });
  }
  if (
    escalationAfterMinutes === undefined ||
    escalationRepeatMinutes === undefined ||
    maxEscalationLevel === undefined ||
    escalationPermissionCode === undefined
  ) {
    return NextResponse.json({ error: "invalid_escalation_configuration" }, { status: 400 });
  }

  const escalationConfigured = escalationAfterMinutes !== null
    || escalationRepeatMinutes !== null
    || escalationPermissionCode !== null
    || maxEscalationLevel !== 1;
  if (escalationConfigured) {
    if (
      escalationAfterMinutes === null ||
      escalationAfterMinutes < 0 ||
      escalationAfterMinutes > 5_256_000
    ) {
      return NextResponse.json({ error: "invalid_escalation_after_minutes" }, { status: 400 });
    }
    if (!Number.isInteger(maxEscalationLevel) || maxEscalationLevel < 1 || maxEscalationLevel > 10) {
      return NextResponse.json({ error: "invalid_max_escalation_level" }, { status: 400 });
    }
    if (
      escalationRepeatMinutes !== null
      && (escalationRepeatMinutes <= 0 || escalationRepeatMinutes > 5_256_000)
    ) {
      return NextResponse.json({ error: "invalid_escalation_repeat_minutes" }, { status: 400 });
    }
    if (maxEscalationLevel > 1 && escalationRepeatMinutes === null) {
      return NextResponse.json({ error: "escalation_repeat_required" }, { status: 400 });
    }
    if (!escalationPermissionCode) {
      return NextResponse.json({ error: "escalation_permission_required" }, { status: 400 });
    }
  }

  const effectiveFrom = body.effectiveFrom ? new Date(body.effectiveFrom) : new Date();
  const effectiveTo = body.effectiveTo ? new Date(body.effectiveTo) : null;
  if (Number.isNaN(effectiveFrom.getTime()) || (effectiveTo && Number.isNaN(effectiveTo.getTime()))) {
    return NextResponse.json({ error: "invalid_effective_date" }, { status: 400 });
  }
  if (effectiveTo && effectiveTo.getTime() < effectiveFrom.getTime()) {
    return NextResponse.json({ error: "invalid_effective_window" }, { status: 400 });
  }

  const [test, branch, escalationPermission] = await Promise.all([
    prisma.labTest.findFirst({
      where: { id: testId, organizationId: session.user.organizationId, status: "ACTIVE" },
      select: { id: true, code: true },
    }),
    branchId
      ? prisma.branch.findFirst({
          where: { id: branchId, organizationId: session.user.organizationId, status: "ACTIVE" },
          select: { id: true, code: true },
        })
      : null,
    escalationConfigured && escalationPermissionCode
      ? prisma.permission.findUnique({ where: { code: escalationPermissionCode }, select: { id: true, code: true } })
      : null,
  ]);

  if (!test) return NextResponse.json({ error: "test_not_found" }, { status: 404 });
  if (branchId && !branch) return NextResponse.json({ error: "branch_not_found" }, { status: 404 });
  if (branchId && !canAccessBranch(session, branchId)) {
    return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });
  }
  if (escalationConfigured && !escalationPermission) {
    return NextResponse.json({ error: "escalation_permission_not_found" }, { status: 404 });
  }

  const sameScopeSameStart = await prisma.testTatPolicy.findFirst({
    where: {
      testId,
      branchId,
      priority,
      effectiveFrom,
    },
    select: { id: true },
  });
  if (sameScopeSameStart) {
    return NextResponse.json({ error: "tat_policy_scope_start_conflict" }, { status: 409 });
  }

  const policy = await prisma.$transaction(async tx => {
    const created = await tx.testTatPolicy.create({
      data: {
        testId,
        branchId,
        priority,
        tatMinutes,
        alertBeforeMinutes,
        escalationAfterMinutes: escalationConfigured ? escalationAfterMinutes : null,
        escalationRepeatMinutes: escalationConfigured ? escalationRepeatMinutes : null,
        maxEscalationLevel: escalationConfigured ? maxEscalationLevel : 1,
        escalationPermissionCode: escalationConfigured ? escalationPermissionCode : null,
        effectiveFrom,
        effectiveTo,
        approvalStatus: "DRAFT",
        status: "INACTIVE",
        createdByUserId: session.userId,
      },
    });

    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: session.activeBranchId,
        actorUserId: session.userId,
        action: "TEST_TAT_POLICY_DRAFT_CREATED",
        entityType: "TestTatPolicy",
        entityId: created.id,
        newValues: {
          testId,
          testCode: test.code,
          branchId,
          branchCode: branch?.code || null,
          priority,
          tatMinutes,
          alertBeforeMinutes,
          escalationAfterMinutes: created.escalationAfterMinutes,
          escalationRepeatMinutes: created.escalationRepeatMinutes,
          maxEscalationLevel: created.maxEscalationLevel,
          escalationPermissionCode: created.escalationPermissionCode,
          effectiveFrom: effectiveFrom.toISOString(),
          effectiveTo: effectiveTo?.toISOString() || null,
          approvalStatus: created.approvalStatus,
          status: created.status,
        },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });

    return created;
  });

  return NextResponse.json({ policy }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!permissionSet(session).has("catalog.tat_policies.approve")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const ctx = await requestContext();
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const policyId = id(body.id);
  const action = typeof body.action === "string" ? body.action.trim().toUpperCase() : "";
  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 1000) : "";
  if (!policyId || !["APPROVE", "RETIRE"].includes(action)) {
    return NextResponse.json({ error: "invalid_tat_policy_action" }, { status: 400 });
  }

  const policy = await prisma.testTatPolicy.findFirst({
    where: { id: policyId, test: { organizationId: session.user.organizationId } },
    include: { test: { select: { code: true } }, branch: { select: { code: true } } },
  });
  if (!policy) return NextResponse.json({ error: "tat_policy_not_found" }, { status: 404 });
  if (policy.branchId && !canAccessBranch(session, policy.branchId)) {
    return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });
  }

  if (action === "APPROVE") {
    if (policy.approvalStatus !== "DRAFT") {
      return NextResponse.json({ error: "tat_policy_not_draft", approvalStatus: policy.approvalStatus }, { status: 409 });
    }

    try {
      const updated = await prisma.$transaction(async tx => {
        await tx.$queryRaw(Prisma.sql`SELECT id FROM lab_tests WHERE id = ${policy.testId} FOR UPDATE`);

        const current = await tx.testTatPolicy.findUniqueOrThrow({ where: { id: policy.id } });
        if (current.approvalStatus !== "DRAFT") throw new Error("TAT_POLICY_STATE_CHANGED");

        const approved = await tx.testTatPolicy.findMany({
          where: {
            testId: current.testId,
            approvalStatus: "APPROVED",
            status: "ACTIVE",
            id: { not: current.id },
          },
        });
        const plan = planTatPolicyApproval(current, approved);
        if (plan.conflicts.length > 0) {
          throw new Error("TAT_POLICY_APPROVED_OVERLAP:" + plan.conflicts.join(","));
        }

        const approvedAt = new Date();
        const predecessorEffectiveTo = new Date(current.effectiveFrom.getTime() - 1);
        for (const predecessorId of plan.predecessorsToClose) {
          const predecessor = approved.find(item => item.id === predecessorId);
          if (!predecessor) continue;
          await tx.testTatPolicy.update({
            where: { id: predecessorId },
            data: { effectiveTo: predecessorEffectiveTo },
          });
          await tx.auditEvent.create({
            data: {
              organizationId: session.user.organizationId,
              branchId: session.activeBranchId,
              actorUserId: session.userId,
              action: "TEST_TAT_POLICY_SUPERSEDED",
              entityType: "TestTatPolicy",
              entityId: predecessorId,
              oldValues: { effectiveTo: predecessor.effectiveTo },
              newValues: {
                effectiveTo: predecessorEffectiveTo,
                supersededByPolicyId: current.id,
              },
              ipAddress: ctx.ipAddress,
              userAgent: ctx.userAgent,
            },
          });
        }

        const approvedPolicy = await tx.testTatPolicy.update({
          where: { id: current.id },
          data: {
            approvalStatus: "APPROVED",
            status: "ACTIVE",
            approvedByUserId: session.userId,
            approvedAt,
            retiredByUserId: null,
            retiredAt: null,
            retirementReason: null,
          },
        });

        await tx.auditEvent.create({
          data: {
            organizationId: session.user.organizationId,
            branchId: session.activeBranchId,
            actorUserId: session.userId,
            action: "TEST_TAT_POLICY_APPROVED",
            entityType: "TestTatPolicy",
            entityId: current.id,
            oldValues: { approvalStatus: current.approvalStatus, status: current.status },
            newValues: {
              approvalStatus: approvedPolicy.approvalStatus,
              status: approvedPolicy.status,
              approvedAt,
              approvedByUserId: session.userId,
              predecessorsClosed: plan.predecessorsToClose,
            },
            reason: reason || null,
            ipAddress: ctx.ipAddress,
            userAgent: ctx.userAgent,
          },
        });

        return approvedPolicy;
      }, { timeout: 30000 });

      return NextResponse.json({ status: "ok", policy: updated });
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("TAT_POLICY_APPROVED_OVERLAP:")) {
        return NextResponse.json({
          error: "approved_tat_policy_overlap",
          conflictingPolicyIds: error.message.slice("TAT_POLICY_APPROVED_OVERLAP:".length).split(",").filter(Boolean),
        }, { status: 409 });
      }
      if (error instanceof Error && error.message === "TAT_POLICY_STATE_CHANGED") {
        return NextResponse.json({ error: "tat_policy_state_changed" }, { status: 409 });
      }
      throw error;
    }
  }

  if (policy.approvalStatus !== "APPROVED") {
    return NextResponse.json({ error: "only_approved_tat_policy_can_be_retired", approvalStatus: policy.approvalStatus }, { status: 409 });
  }
  if (!reason) {
    return NextResponse.json({ error: "retirement_reason_required" }, { status: 400 });
  }

  const retiredAt = new Date();
  const effectiveTo = policy.effectiveFrom <= retiredAt
    && (policy.effectiveTo === null || policy.effectiveTo > retiredAt)
      ? retiredAt
      : policy.effectiveTo;

  const retired = await prisma.$transaction(async tx => {
    const updated = await tx.testTatPolicy.update({
      where: { id: policy.id },
      data: {
        approvalStatus: "RETIRED",
        status: "INACTIVE",
        effectiveTo,
        retiredByUserId: session.userId,
        retiredAt,
        retirementReason: reason,
      },
    });

    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: session.activeBranchId,
        actorUserId: session.userId,
        action: "TEST_TAT_POLICY_RETIRED",
        entityType: "TestTatPolicy",
        entityId: policy.id,
        oldValues: {
          approvalStatus: policy.approvalStatus,
          status: policy.status,
          effectiveTo: policy.effectiveTo,
        },
        newValues: {
          approvalStatus: updated.approvalStatus,
          status: updated.status,
          effectiveTo,
          retiredAt,
          retiredByUserId: session.userId,
        },
        reason,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });

    return updated;
  });

  return NextResponse.json({ status: "ok", policy: retired });
}
