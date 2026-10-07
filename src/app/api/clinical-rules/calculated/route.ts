import { NextResponse } from "next/server";
import { requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formulaVariables } from "@/lib/formula-engine";

function text(value: unknown, max = 1000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function POST(request: Request) {
  const session = await requirePermission("clinical_rules.manage");
  const ctx = await requestContext();
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const testId = text(body.testId, 36);
  const targetComponentId = text(body.targetComponentId, 36);
  const expression = text(body.expression, 1000);
  const decimalPrecision = body.decimalPrecision === "" || body.decimalPrecision == null ? null : Number(body.decimalPrecision);
  const effectiveFrom = new Date(String(body.effectiveFrom || ""));
  const effectiveTo = body.effectiveTo ? new Date(String(body.effectiveTo)) : null;

  if (!testId || !targetComponentId || !expression || Number.isNaN(effectiveFrom.getTime())) {
    return NextResponse.json({ error: "missing_required_fields" }, { status: 400 });
  }
  if (effectiveTo && (Number.isNaN(effectiveTo.getTime()) || effectiveTo < effectiveFrom)) {
    return NextResponse.json({ error: "invalid_effective_dates" }, { status: 400 });
  }
  if (decimalPrecision !== null && (!Number.isInteger(decimalPrecision) || decimalPrecision < 0 || decimalPrecision > 12)) {
    return NextResponse.json({ error: "invalid_decimal_precision" }, { status: 400 });
  }

  const test = await prisma.labTest.findFirst({
    where: { id: testId, organizationId: session.user.organizationId, status: "ACTIVE" },
    include: {
      components: { where: { status: "ACTIVE" } },
      calculatedRules: {
        where: {
          status: "ACTIVE",
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: effectiveFrom } }],
        },
      },
    },
  });
  if (!test) return NextResponse.json({ error: "test_not_found" }, { status: 404 });

  const target = test.components.find(component => component.id === targetComponentId);
  if (!target) return NextResponse.json({ error: "target_component_not_found" }, { status: 404 });
  if (target.resultType !== "NUMERIC") {
    return NextResponse.json({ error: "calculated_target_must_be_numeric" }, { status: 409 });
  }

  let variables: string[];
  try {
    variables = formulaVariables(expression);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message.toLowerCase() : "invalid_formula" }, { status: 400 });
  }
  if (variables.length === 0) return NextResponse.json({ error: "formula_requires_component_variables" }, { status: 400 });

  const byCode = new Map(test.components.map(component => [component.code.toUpperCase(), component]));
  for (const variable of variables) {
    const source = byCode.get(variable);
    if (!source) return NextResponse.json({ error: "formula_component_not_found", componentCode: variable }, { status: 409 });
    if (source.id === targetComponentId) return NextResponse.json({ error: "formula_cannot_reference_target_component" }, { status: 409 });
    if (source.resultType !== "NUMERIC") return NextResponse.json({ error: "formula_source_must_be_numeric", componentCode: variable }, { status: 409 });
    if (test.calculatedRules.some(rule => rule.targetComponentId === source.id)) {
      return NextResponse.json({ error: "calculated_formula_chaining_not_supported", componentCode: variable }, { status: 409 });
    }
  }

  const rule = await prisma.$transaction(async tx => {
    const created = await tx.calculatedResultRule.create({
      data: {
        organizationId: session.user.organizationId,
        testId,
        targetComponentId,
        expression,
        decimalPrecision,
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
        action: "CALCULATED_RESULT_RULE_DRAFT_CREATED",
        entityType: "CalculatedResultRule",
        entityId: created.id,
        newValues: { testId, targetComponentId, expression, variables, decimalPrecision, effectiveFrom, effectiveTo },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
    return created;
  });

  return NextResponse.json({ status: "ok", rule }, { status: 201 });
}
