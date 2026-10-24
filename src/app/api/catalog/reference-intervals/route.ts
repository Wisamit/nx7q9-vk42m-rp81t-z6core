import { NextRequest, NextResponse } from "next/server";
import { canAccessBranch, getCurrentSession, permissionSet, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { normalizePopulationCode } from "@/lib/result-reference";
import { planReferenceIntervalApproval } from "@/lib/reference-interval-governance";
import { parseReferenceIntervalEffectiveFrom, validateReferenceRangeDecimals } from "@/lib/reference-interval-draft-decimals";

// Never shorten an untrusted scope or clinical ID into an unrelated identity.
function id(value: unknown) {
  return typeof value === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)
    ? value : null;
}

async function hasOrganizationWideReferenceScope(
  organizationId: string, authorizedBranchIds: readonly string[],
) {
  const active = await prisma.branch.findMany({
    where: { organizationId, status: "ACTIVE" }, select: { id: true },
  });
  const granted = new Set(authorizedBranchIds);
  return active.length > 0 && active.every(branch => granted.has(branch.id));
}

export async function POST(request: NextRequest) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!permissionSet(session).has("catalog.reference_ranges.manage")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const ctx = await requestContext();
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const componentId = id(body.componentId) || "";
  const branchId = id(body.branchId);
  const methodId = id(body.methodId);
  const analyzerId = id(body.analyzerId);
  const specimenTypeId = id(body.specimenTypeId);
  if (["branchId", "methodId", "analyzerId", "specimenTypeId"].some(key =>
      body[key] !== "" && body[key] !== null && body[key] !== undefined && !id(body[key]))) {
    return NextResponse.json({ error: "invalid_reference_context_id" }, { status: 400 });
  }
  if (body.populationCode != null &&
      (typeof body.populationCode !== "string" || body.populationCode.length > 80)) {
    return NextResponse.json({ error: "invalid_population_code" }, { status: 400 });
  }
  const populationCode = normalizePopulationCode(
    typeof body.populationCode === "string" ? body.populationCode : null,
  );
  if (branchId && !canAccessBranch(session, branchId)) {
    return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });
  }
  if (!branchId && !await hasOrganizationWideReferenceScope(
    session.user.organizationId,
    session.user.branchScopes.filter(item => item.branch.status === "ACTIVE").map(item => item.branchId),
  )) {
    return NextResponse.json({ error: "organization_scope_incomplete" }, { status: 403 });
  }
  if (body.sex != null && body.sex !== "" &&
      !["ANY", "MALE", "FEMALE"].includes(body.sex)) {
    return NextResponse.json({ error: "invalid_sex" }, { status: 400 });
  }

  const pregnancyStatus =
    body.pregnancyStatus === "PREGNANT" || body.pregnancyStatus === "NOT_PREGNANT"
      ? body.pregnancyStatus
      : body.pregnancyStatus === "" || body.pregnancyStatus === null || body.pregnancyStatus === undefined || body.pregnancyStatus === "ANY"
        ? null
        : undefined;

  const admission = validateReferenceRangeDecimals(body);
  if (!admission.ok) {
    return NextResponse.json({ error: admission.error }, { status: 400 });
  }
  const {
    ageFrom, ageTo, gestationalAgeFromWeeks, gestationalAgeToWeeks,
    lowValue, highValue, criticalLow, criticalHigh,
  } = admission.values;
  if (pregnancyStatus === undefined) {
    return NextResponse.json({ error: "invalid_pregnancy_status" }, { status: 400 });
  }
  if ((ageFrom !== null || ageTo !== null) && !["DAY", "WEEK", "MONTH", "YEAR"].includes(body.ageUnit)) {
    return NextResponse.json({ error: "age_unit_required_for_age_bounds" }, { status: 400 });
  }
  if ((gestationalAgeFromWeeks !== null || gestationalAgeToWeeks !== null) &&
      pregnancyStatus !== "PREGNANT") {
    return NextResponse.json({ error: "gestational_age_requires_pregnant_context" }, { status: 400 });
  }
  if (body.normalTextEn != null && (typeof body.normalTextEn !== "string" ||
      body.normalTextEn.length > 500)) {
    return NextResponse.json({ error: "invalid_normal_text" }, { status: 400 });
  }
  if (body.normalTextAr != null && (typeof body.normalTextAr !== "string" ||
      body.normalTextAr.length > 500)) {
    return NextResponse.json({ error: "invalid_normal_text" }, { status: 400 });
  }
  if (body.source != null && (typeof body.source !== "string" ||
      body.source.length > 255)) {
    return NextResponse.json({ error: "invalid_source" }, { status: 400 });
  }

  const effectiveFrom = parseReferenceIntervalEffectiveFrom(body.effectiveFrom);
  if (!effectiveFrom) {
    return NextResponse.json({ error: "invalid_effective_date" }, { status: 400 });
  }

  const [component, branch, method, analyzer, specimenType] = await Promise.all([
    prisma.testComponent.findFirst({
      where: { id: componentId, test: { organizationId: session.user.organizationId } },
      select: { id: true },
    }),
    branchId
      ? prisma.branch.findFirst({
          where: { id: branchId, organizationId: session.user.organizationId, status: "ACTIVE" },
          select: { id: true },
        })
      : null,
    methodId
      ? prisma.method.findFirst({
          where: { id: methodId, organizationId: session.user.organizationId, status: "ACTIVE" },
          select: { id: true },
        })
      : null,
    analyzerId
      ? prisma.analyzer.findFirst({
          where: { id: analyzerId, organizationId: session.user.organizationId, status: "ACTIVE" },
          select: { id: true, branchId: true },
        })
      : null,
    specimenTypeId
      ? prisma.specimenType.findFirst({
          where: { id: specimenTypeId, organizationId: session.user.organizationId, status: "ACTIVE" },
          select: { id: true },
        })
      : null,
  ]);

  if (!component) return NextResponse.json({ error: "component_not_found" }, { status: 404 });
  if (branchId && !branch) return NextResponse.json({ error: "branch_not_found" }, { status: 404 });
  if (methodId && !method) return NextResponse.json({ error: "method_not_found" }, { status: 404 });
  if (analyzerId && !analyzer) return NextResponse.json({ error: "analyzer_not_found" }, { status: 404 });
  if (specimenTypeId && !specimenType) return NextResponse.json({ error: "specimen_type_not_found" }, { status: 404 });
  if (branchId && analyzer && analyzer.branchId !== branchId) {
    return NextResponse.json({ error: "analyzer_branch_mismatch" }, { status: 409 });
  }

  try {
    const interval = await prisma.$transaction(async tx => {
      const created = await tx.referenceInterval.create({
        data: {
          componentId,
          branchId,
          methodId,
          analyzerId,
          specimenTypeId,
          sex: ["MALE", "FEMALE"].includes(body.sex) ? body.sex : "ANY",
          ageFrom,
          ageTo,
          ageUnit: ["DAY", "WEEK", "MONTH", "YEAR"].includes(body.ageUnit) ? body.ageUnit : null,
          pregnancyStatus,
          gestationalAgeFromWeeks,
          gestationalAgeToWeeks,
          populationCode,
          lowValue,
          highValue,
          normalTextEn: typeof body.normalTextEn === "string" ? body.normalTextEn.trim() || null : null,
          normalTextAr: typeof body.normalTextAr === "string" ? body.normalTextAr.trim() || null : null,
          criticalLow,
          criticalHigh,
          source: typeof body.source === "string" ? body.source.trim() || null : null,
          notes: typeof body.notes === "string" ? body.notes.trim() || null : null,
          effectiveFrom,
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
          action: "REFERENCE_INTERVAL_DRAFT_CREATED",
          entityType: "ReferenceInterval",
          entityId: created.id,
          newValues: {
            componentId,
            branchId,
            methodId,
            analyzerId,
            specimenTypeId,
            sex: created.sex,
            ageFrom,
            ageTo,
            ageUnit: created.ageUnit,
            pregnancyStatus,
            gestationalAgeFromWeeks,
            gestationalAgeToWeeks,
            populationCode,
            lowValue,
            highValue,
            criticalLow,
            criticalHigh,
            source: created.source,
            approvalStatus: created.approvalStatus,
            status: created.status,
            effectiveFrom: effectiveFrom.toISOString(),
          },
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
      });
      return created;
    });
    return NextResponse.json({ interval }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "create_failed" }, { status: 409 });
  }
}


export async function PATCH(request: NextRequest) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!permissionSet(session).has("catalog.reference_ranges.approve")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const ctx = await requestContext();
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const intervalId = id(body.id);
  const action = typeof body.action === "string" ? body.action.trim().toUpperCase() : "";
  if (body.reason != null && (typeof body.reason !== "string" || body.reason.length > 1000)) {
    return NextResponse.json({ error: "invalid_reference_interval_reason" }, { status: 400 });
  }
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (!intervalId || !["APPROVE", "RETIRE"].includes(action)) {
    return NextResponse.json({ error: "invalid_reference_interval_action" }, { status: 400 });
  }

  const interval = await prisma.referenceInterval.findFirst({
    where: {
      id: intervalId,
      component: { test: { organizationId: session.user.organizationId } },
    },
  });
  if (!interval) return NextResponse.json({ error: "reference_interval_not_found" }, { status: 404 });
  if (interval.branchId && !canAccessBranch(session, interval.branchId)) {
    return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });
  }
  if (!interval.branchId && !await hasOrganizationWideReferenceScope(
    session.user.organizationId,
    session.user.branchScopes.filter(item => item.branch.status === "ACTIVE").map(item => item.branchId),
  )) {
    return NextResponse.json({ error: "organization_scope_incomplete" }, { status: 403 });
  }

  if (action === "APPROVE") {
    if (interval.approvalStatus !== "DRAFT") {
      return NextResponse.json({ error: "reference_interval_not_draft", approvalStatus: interval.approvalStatus }, { status: 409 });
    }

    const approved = await prisma.referenceInterval.findMany({
      where: {
        componentId: interval.componentId,
        approvalStatus: "APPROVED",
        status: "ACTIVE",
        id: { not: interval.id },
      },
    });
    const plan = planReferenceIntervalApproval(interval, approved);
    if (plan.conflicts.length > 0) {
      return NextResponse.json({
        error: "approved_reference_interval_overlap",
        conflictingIntervalIds: plan.conflicts,
      }, { status: 409 });
    }

    const approvedAt = new Date();
    const predecessorEffectiveTo = new Date(interval.effectiveFrom.getTime() - 1);

    const updated = await prisma.$transaction(async tx => {
      for (const predecessorId of plan.predecessorsToClose) {
        const predecessor = approved.find(item => item.id === predecessorId);
        if (!predecessor) continue;
        await tx.referenceInterval.update({
          where: { id: predecessorId },
          data: { effectiveTo: predecessorEffectiveTo },
        });
        await tx.auditEvent.create({
          data: {
            organizationId: session.user.organizationId,
            branchId: session.activeBranchId,
            actorUserId: session.userId,
            action: "REFERENCE_INTERVAL_SUPERSEDED",
            entityType: "ReferenceInterval",
            entityId: predecessorId,
            oldValues: { effectiveTo: predecessor.effectiveTo },
            newValues: { effectiveTo: predecessorEffectiveTo, supersededByIntervalId: interval.id },
            ipAddress: ctx.ipAddress,
            userAgent: ctx.userAgent,
          },
        });
      }

      const approvedInterval = await tx.referenceInterval.update({
        where: { id: interval.id },
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
          action: "REFERENCE_INTERVAL_APPROVED",
          entityType: "ReferenceInterval",
          entityId: interval.id,
          oldValues: { approvalStatus: interval.approvalStatus, status: interval.status },
          newValues: {
            approvalStatus: approvedInterval.approvalStatus,
            status: approvedInterval.status,
            approvedAt,
            approvedByUserId: session.userId,
            predecessorsClosed: plan.predecessorsToClose,
          },
          reason: reason || null,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
      });

      return approvedInterval;
    });

    return NextResponse.json({ status: "ok", interval: updated });
  }

  if (interval.approvalStatus !== "APPROVED") {
    return NextResponse.json({ error: "only_approved_reference_interval_can_be_retired", approvalStatus: interval.approvalStatus }, { status: 409 });
  }
  if (!reason) {
    return NextResponse.json({ error: "retirement_reason_required" }, { status: 400 });
  }

  const retiredAt = new Date();
  const effectiveTo = interval.effectiveFrom <= retiredAt
    && (interval.effectiveTo === null || interval.effectiveTo > retiredAt)
      ? retiredAt
      : interval.effectiveTo;

  const retired = await prisma.$transaction(async tx => {
    const updated = await tx.referenceInterval.update({
      where: { id: interval.id },
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
        action: "REFERENCE_INTERVAL_RETIRED",
        entityType: "ReferenceInterval",
        entityId: interval.id,
        oldValues: {
          approvalStatus: interval.approvalStatus,
          status: interval.status,
          effectiveTo: interval.effectiveTo,
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

  return NextResponse.json({ status: "ok", interval: retired });
}
