import { NextResponse } from "next/server";
import { requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";

function text(value: unknown, max = 500) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function overlaps(
  aStart: Date,
  aEnd: Date | null,
  bStart: Date,
  bEnd: Date | null,
) {
  return (aEnd === null || bStart <= aEnd) && (bEnd === null || aStart <= bEnd);
}

export async function POST(request: Request) {
  const session = await requirePermission("clinical_rules.manage");
  const ctx = await requestContext();
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const testId = text(body.testId, 36);
  const branchId = text(body.branchId, 36) || null;
  const enabled = body.enabled === true;
  const allowManual = body.allowManual === true;
  const allowAnalyzer = body.allowAnalyzer !== false;
  const allowImport = body.allowImport === true;
  const requireNoCritical = true;
  const requireDeltaWithinLimit = true;
  const requireNoPendingReflex = true;
  const requireNoBlockingHolds = true;
  const requireAllFlagsNormal = body.requireAllFlagsNormal === true;
  const effectiveFrom = new Date(String(body.effectiveFrom || ""));
  const effectiveTo = body.effectiveTo ? new Date(String(body.effectiveTo)) : null;

  if (!testId || Number.isNaN(effectiveFrom.getTime())) {
    return NextResponse.json({ error: "missing_required_fields" }, { status: 400 });
  }
  if (effectiveTo && (Number.isNaN(effectiveTo.getTime()) || effectiveTo < effectiveFrom)) {
    return NextResponse.json({ error: "invalid_effective_dates" }, { status: 400 });
  }

  const [test, branchRecord, existing] = await Promise.all([
    prisma.labTest.findFirst({ where: { id: testId, organizationId: session.user.organizationId, status: "ACTIVE" } }),
    branchId
      ? prisma.branch.findFirst({ where: { id: branchId, organizationId: session.user.organizationId, status: "ACTIVE" } })
      : Promise.resolve(null),
    prisma.autoverificationPolicy.findMany({
      where: {
        organizationId: session.user.organizationId,
        testId,
        branchId,
        status: "ACTIVE",
      },
      select: { id: true, effectiveFrom: true, effectiveTo: true },
    }),
  ]);

  if (!test) return NextResponse.json({ error: "test_not_found" }, { status: 404 });
  if (branchId && !branchRecord) return NextResponse.json({ error: "branch_not_found" }, { status: 404 });
  if (existing.some(policy => overlaps(effectiveFrom, effectiveTo, policy.effectiveFrom, policy.effectiveTo))) {
    return NextResponse.json({ error: "overlapping_autoverification_policy" }, { status: 409 });
  }

  const policy = await prisma.$transaction(async tx => {
    const created = await tx.autoverificationPolicy.create({
      data: {
        organizationId: session.user.organizationId,
        testId,
        branchId,
        enabled,
        allowManual,
        allowAnalyzer,
        allowImport,
        requireNoCritical,
        requireDeltaWithinLimit,
        requireNoPendingReflex,
        requireNoBlockingHolds,
        requireAllFlagsNormal,
        effectiveFrom,
        effectiveTo,
      },
    });

    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: session.activeBranchId,
        actorUserId: session.user.id,
        action: "AUTOVERIFICATION_POLICY_CREATED",
        entityType: "AutoverificationPolicy",
        entityId: created.id,
        newValues: {
          testId,
          branchId,
          enabled,
          allowManual,
          allowAnalyzer,
          allowImport,
          requireNoCritical,
          requireDeltaWithinLimit,
          requireNoPendingReflex,
          requireNoBlockingHolds,
          requireAllFlagsNormal,
          effectiveFrom,
          effectiveTo,
        },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
    return created;
  });

  return NextResponse.json({ status: "ok", policy }, { status: 201 });
}
