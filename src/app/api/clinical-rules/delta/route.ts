import { NextResponse } from "next/server";
import { canAccessBranch, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {ClinicalDecimalError,parseClinicalRuleDecimal} from "@/lib/clinical-rule-decimal";

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
  let absoluteLimit: string | null;
  let percentLimit: string | null;
  try {
    absoluteLimit = parseClinicalRuleDecimal(body.absoluteLimit,
      {precision:24,scale:8,nonNegative:true});
    percentLimit = parseClinicalRuleDecimal(body.percentLimit,
      {precision:18,scale:6,nonNegative:true});
  } catch (error) {
    if (error instanceof ClinicalDecimalError)
      return NextResponse.json({error:error.code},{status:400});
    throw error;
  }
  const lookbackDays = Number(body.lookbackDays || 365);
  const effectiveFrom = new Date(String(body.effectiveFrom || ""));
  const effectiveTo = body.effectiveTo ? new Date(String(body.effectiveTo)) : null;

  if (!testId || Number.isNaN(effectiveFrom.getTime())) return NextResponse.json({ error: "missing_required_fields" }, { status: 400 });
  if (effectiveTo && (Number.isNaN(effectiveTo.getTime()) || effectiveTo < effectiveFrom)) return NextResponse.json({ error: "invalid_effective_dates" }, { status: 400 });
  if (absoluteLimit === null && percentLimit === null) return NextResponse.json({ error: "delta_limit_required" }, { status: 400 });
  if (!Number.isInteger(lookbackDays) || lookbackDays < 1 || lookbackDays > 3650) return NextResponse.json({ error: "invalid_lookback" }, { status: 400 });

  const [test, branchRecord, methodRecord] = await Promise.all([
    prisma.labTest.findFirst({
      where: { id: testId, organizationId: session.user.organizationId, status: "ACTIVE" },
      include: { components: { where: { status: "ACTIVE" } } },
    }),
    branchId
      ? prisma.branch.findFirst({ where: { id: branchId, organizationId: session.user.organizationId, status: "ACTIVE" } })
      : Promise.resolve(null),
    methodId
      ? prisma.method.findFirst({ where: { id: methodId, organizationId: session.user.organizationId, status: "ACTIVE" } })
      : Promise.resolve(null),
  ]);
  if (!test) return NextResponse.json({ error: "test_not_found" }, { status: 404 });
  if (branchId && !branchRecord) return NextResponse.json({ error: "branch_not_found" }, { status: 404 });
  if (branchId && !canAccessBranch(session, branchId)) return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });
  if (methodId && !methodRecord) return NextResponse.json({ error: "method_not_found" }, { status: 404 });
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
        absoluteLimit,
        percentLimit,
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
