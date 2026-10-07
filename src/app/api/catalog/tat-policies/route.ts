import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession, permissionSet } from "@/lib/auth";
import { prisma } from "@/lib/db";

function id(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 36) : null;
}

function integer(value: unknown) {
  if (value === "" || value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : undefined;
}

export async function POST(request: NextRequest) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!permissionSet(session).has("catalog.manage")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

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

  const effectiveFrom = body.effectiveFrom ? new Date(body.effectiveFrom) : new Date();
  const effectiveTo = body.effectiveTo ? new Date(body.effectiveTo) : null;
  if (Number.isNaN(effectiveFrom.getTime()) || (effectiveTo && Number.isNaN(effectiveTo.getTime()))) {
    return NextResponse.json({ error: "invalid_effective_date" }, { status: 400 });
  }
  if (effectiveTo && effectiveTo.getTime() < effectiveFrom.getTime()) {
    return NextResponse.json({ error: "invalid_effective_window" }, { status: 400 });
  }

  const [test, branch] = await Promise.all([
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
  ]);

  if (!test) return NextResponse.json({ error: "test_not_found" }, { status: 404 });
  if (branchId && !branch) return NextResponse.json({ error: "branch_not_found" }, { status: 404 });

  const sameScopeSameStart = await prisma.testTatPolicy.findFirst({
    where: {
      testId,
      branchId,
      priority,
      effectiveFrom,
      status: "ACTIVE",
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
        effectiveFrom,
        effectiveTo,
        createdByUserId: session.userId,
      },
    });

    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: session.activeBranchId,
        actorUserId: session.userId,
        action: "TEST_TAT_POLICY_CREATED",
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
          effectiveFrom: effectiveFrom.toISOString(),
          effectiveTo: effectiveTo?.toISOString() || null,
        },
      },
    });

    return created;
  });

  return NextResponse.json({ policy }, { status: 201 });
}
