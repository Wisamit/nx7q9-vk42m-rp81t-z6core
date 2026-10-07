import { NextResponse } from "next/server";
import { requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";

function text(value: unknown, max = 220) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function POST(request: Request) {
  const session = await requirePermission("clinical_rules.manage");
  const ctx = await requestContext();
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const testId = text(body.testId, 36);
  const componentId = text(body.componentId, 36) || null;
  const branchId = text(body.branchId, 36) || null;
  const methodId = text(body.methodId, 36) || null;
  const absoluteLimit = body.absoluteLimit === "" || body.absoluteLimit == null ? null : Number(body.absoluteLimit);
  const percentLimit = body.percentLimit === "" || body.percentLimit == null ? null : Number(body.percentLimit);
  const lookbackDays = Number(body.lookbackDays || 365);
  const effectiveFrom = new Date(String(body.effectiveFrom || ""));
  const effectiveTo = body.effectiveTo ? new Date(String(body.effectiveTo)) : null;

  if (!testId || Number.isNaN(effectiveFrom.getTime())) return NextResponse.json({ error: "missing_required_fields" }, { status: 400 });
  if (effectiveTo && (Number.isNaN(effectiveTo.getTime()) || effectiveTo < effectiveFrom)) return NextResponse.json({ error: "invalid_effective_dates" }, { status: 400 });
  if (absoluteLimit === null && percentLimit === null) return NextResponse.json({ error: "delta_limit_required" }, { status: 400 });
  if ((absoluteLimit !== null && (!Number.isFinite(absoluteLimit) || absoluteLimit < 0)) || (percentLimit !== null && (!Number.isFinite(percentLimit) || percentLimit < 0))) {
    return NextResponse.json({ error: "invalid_delta_limits" }, { status: 400 });
  }
  if (!Number.isInteger(lookbackDays) || lookbackDays < 1 || lookbackDays > 3650) return NextResponse.json({ error: "invalid_lookback" }, { status: 400 });

  const test = await prisma.labTest.findFirst({
    where: { id: testId, organizationId: session.user.organizationId },
    include: { components: true },
  });
  if (!test) return NextResponse.json({ error: "test_not_found" }, { status: 404 });
  if (componentId && !test.components.some(component => component.id === componentId)) {
    return NextResponse.json({ error: "component_not_belong_to_test" }, { status: 409 });
  }

  const rule = await prisma.$transaction(async (tx) => {
    const created = await tx.deltaRule.create({
      data: {
        organizationId: session.user.organizationId,
        testId,
        componentId,
        branchId,
        methodId,
        absoluteLimit: absoluteLimit === null ? null : absoluteLimit.toFixed(8),
        percentLimit: percentLimit === null ? null : percentLimit.toFixed(6),
        lookbackDays,
        effectiveFrom,
        effectiveTo,
        status: "INACTIVE",
      },
    });

    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: session.activeBranchId,
        actorUserId: session.user.id,
        action: "DELTA_RULE_DRAFT_CREATED",
        entityType: "DeltaRule",
        entityId: created.id,
        newValues: {
          testId,
          componentId,
          branchId,
          methodId,
          absoluteLimit,
          percentLimit,
          lookbackDays,
          effectiveFrom,
          effectiveTo,
        },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });

    return created;
  });

  return NextResponse.json({ status: "ok", rule }, { status: 201 });
}
