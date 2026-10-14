import { NextResponse } from "next/server";
import { canAccessBranch, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ClinicalDecimalError, parseClinicalRuleDecimal } from "@/lib/clinical-rule-decimal";

function text(value: unknown, max = 500) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function POST(request: Request) {
  const session = await requirePermission("clinical_rules.manage");
  const ctx = await requestContext();
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const sourceTestId = text(body.sourceTestId, 36);
  const sourceComponentId = text(body.sourceComponentId, 36) || null;
  const branchId = text(body.branchId, 36) || null;
  const targetTestId = text(body.targetTestId, 36);
  const operator = ["LT","LTE","GT","GTE","EQ","NE","CONTAINS"].includes(body.operator) ? body.operator : null;
  let numericThreshold: string | null;
  try {
    numericThreshold = parseClinicalRuleDecimal(body.numericThreshold, {precision:24,scale:8});
  } catch (error) {
    if (error instanceof ClinicalDecimalError)
      return NextResponse.json({error:error.code},{status:400});
    throw error;
  }
  const textThreshold = text(body.textThreshold, 500) || null;
  const noteEn = text(body.noteEn, 500) || null;
  const noteAr = text(body.noteAr, 500) || null;
  const effectiveFrom = new Date(String(body.effectiveFrom || ""));
  const effectiveTo = body.effectiveTo ? new Date(String(body.effectiveTo)) : null;

  if (!sourceTestId || !targetTestId || !operator || Number.isNaN(effectiveFrom.getTime())) {
    return NextResponse.json({ error: "missing_required_fields" }, { status: 400 });
  }
  if (sourceTestId === targetTestId) return NextResponse.json({ error: "reflex_target_must_differ_from_source_test" }, { status: 409 });
  if (effectiveTo && (Number.isNaN(effectiveTo.getTime()) || effectiveTo < effectiveFrom)) {
    return NextResponse.json({ error: "invalid_effective_dates" }, { status: 400 });
  }

  const [sourceTest, targetTest, branchRecord] = await Promise.all([
    prisma.labTest.findFirst({
      where: { id: sourceTestId, organizationId: session.user.organizationId, status: "ACTIVE" },
      include: { components: { where: { status: "ACTIVE" } } },
    }),
    prisma.labTest.findFirst({
      where: { id: targetTestId, organizationId: session.user.organizationId, status: "ACTIVE" },
    }),
    branchId ? prisma.branch.findFirst({ where: { id: branchId, organizationId: session.user.organizationId, status: "ACTIVE" } }) : Promise.resolve(null),
  ]);

  if (!sourceTest || !targetTest) return NextResponse.json({ error: "source_or_target_test_not_found" }, { status: 404 });
  if (branchId && !branchRecord) return NextResponse.json({ error: "branch_not_found" }, { status: 404 });
  if (branchId && !canAccessBranch(session, branchId)) return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });

  const sourceComponent = sourceComponentId
    ? sourceTest.components.find(component => component.id === sourceComponentId)
    : null;
  if (sourceTest.components.length > 0 && !sourceComponent) {
    return NextResponse.json({ error: "source_component_required_for_multi_component_test" }, { status: 409 });
  }

  const resultType = sourceComponent?.resultType || sourceTest.resultType;
  const numericOperator = ["LT","LTE","GT","GTE"].includes(operator) || (["EQ","NE"].includes(operator) && resultType === "NUMERIC");

  if (numericOperator) {
    if (resultType !== "NUMERIC") return NextResponse.json({ error: "numeric_operator_requires_numeric_source" }, { status: 409 });
    if (numericThreshold === null) return NextResponse.json({ error: "numeric_threshold_required" }, { status: 400 });
  } else {
    if (!textThreshold) return NextResponse.json({ error: "text_threshold_required" }, { status: 400 });
  }

  const rule = await prisma.$transaction(async tx => {
    const created = await tx.reflexRule.create({
      data: {
        organizationId: session.user.organizationId,
        sourceTestId,
        sourceComponentId,
        branchId,
        operator,
        numericThreshold: numericOperator ? numericThreshold : null,
        textThreshold: numericOperator ? null : textThreshold,
        targetTestId,
        noteEn,
        noteAr,
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
        action: "REFLEX_RULE_DRAFT_CREATED",
        entityType: "ReflexRule",
        entityId: created.id,
        newValues: {
          sourceTestId,
          sourceComponentId,
          branchId,
          operator,
          numericThreshold: numericOperator ? numericThreshold : null,
          textThreshold: numericOperator ? null : textThreshold,
          targetTestId,
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
