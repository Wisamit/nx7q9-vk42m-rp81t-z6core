import { NextResponse } from "next/server";
import { Prisma } from "../../../../generated/prisma/client";
import { canAccessBranch, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { numericFlag, resolveReferenceInterval } from "@/lib/result-reference";
import { evaluateDelta } from "@/lib/delta-check";
import { evaluateFormula, formulaVariables } from "@/lib/formula-engine";
import { reflexMatches } from "@/lib/reflex-rules";

function text(value: unknown, max = 5000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function parseValue(resultType: "NUMERIC" | "TEXT" | "QUALITATIVE" | "BOOLEAN" | "DATE", raw: unknown) {
  if (raw === null || raw === undefined || raw === "") return null;

  if (resultType === "NUMERIC") {
    const value = String(raw).trim();
    if (!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(value)) throw new Error("INVALID_NUMERIC_VALUE");
    const numeric = new Prisma.Decimal(value);
    return { valueNumeric: numeric, valueText: null, valueBoolean: null, valueDate: null, displayValue: value };
  }

  if (resultType === "BOOLEAN") {
    const normalized = typeof raw === "boolean" ? raw : String(raw).toLowerCase() === "true" ? true : String(raw).toLowerCase() === "false" ? false : null;
    if (normalized === null) throw new Error("INVALID_BOOLEAN_VALUE");
    return { valueNumeric: null, valueText: null, valueBoolean: normalized, valueDate: null, displayValue: normalized ? "True" : "False" };
  }

  if (resultType === "DATE") {
    const value = new Date(String(raw));
    if (Number.isNaN(value.getTime())) throw new Error("INVALID_DATE_VALUE");
    return { valueNumeric: null, valueText: null, valueBoolean: null, valueDate: value, displayValue: value.toISOString().slice(0, 10) };
  }

  const value = text(raw, 1000);
  if (!value) return null;
  return { valueNumeric: null, valueText: value, valueBoolean: null, valueDate: null, displayValue: value };
}

export async function POST(request: Request) {
  const session = await requirePermission("results.enter");
  const ctx = await requestContext();
  const body = await request.json().catch(() => null) as {
    orderItemId?: string;
    specimenId?: string;
    performingBranchId?: string;
    comments?: string;
    values?: Array<{ componentId?: string | null; rawValue?: unknown }>;
  } | null;

  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const orderItemId = text(body.orderItemId, 36);
  const specimenId = text(body.specimenId, 36);
  const performingBranchId = text(body.performingBranchId, 36);
  const comments = text(body.comments, 5000);

  if (!orderItemId || !specimenId || !performingBranchId || !Array.isArray(body.values)) {
    return NextResponse.json({ error: "missing_required_fields" }, { status: 400 });
  }
  if (!canAccessBranch(session, performingBranchId)) {
    return NextResponse.json({ error: "performing_branch_forbidden" }, { status: 403 });
  }

  const orderItem = await prisma.orderItem.findFirst({
    where: {
      id: orderItemId,
      order: { organizationId: session.user.organizationId },
    },
    include: {
      order: { include: { patient: true } },
      test: {
        include: {
          defaultUnit: true,
          method: true,
          components: {
            where: { status: "ACTIVE" },
            include: { unit: true },
            orderBy: [{ displayOrder: "asc" }, { code: "asc" }],
          },
          calculatedRules: {
            where: {
              status: "ACTIVE",
              effectiveFrom: { lte: new Date() },
              OR: [{ effectiveTo: null }, { effectiveTo: { gte: new Date() } }],
            },
            include: { targetComponent: true },
          },
          sourceReflexRules: {
            where: {
              status: "ACTIVE",
              effectiveFrom: { lte: new Date() },
              OR: [{ effectiveTo: null }, { effectiveTo: { gte: new Date() } }],
            },
            include: { targetTest: true },
          },
        },
      },
      specimenLinks: {
        where: { specimenId },
        include: { specimen: true },
      },
      results: { orderBy: { version: "desc" }, take: 1, include: { values: true } },
    },
  });

  if (!orderItem) return NextResponse.json({ error: "order_item_not_found" }, { status: 404 });

  const specimenLink = orderItem.specimenLinks[0];
  const specimen = specimenLink?.specimen;
  if (!specimen) return NextResponse.json({ error: "specimen_not_linked_to_order_item" }, { status: 409 });
  if (!["RECEIVED", "IN_PROCESS"].includes(specimen.status)) {
    return NextResponse.json({ error: "specimen_not_ready_for_results", status: specimen.status }, { status: 409 });
  }
  if (specimen.currentBranchId !== performingBranchId) {
    return NextResponse.json({ error: "performing_branch_must_match_specimen_location" }, { status: 409 });
  }

  const existing = orderItem.results[0];
  if (existing && ["VERIFIED", "RELEASED", "AMENDED", "CANCELLED"].includes(existing.status)) {
    return NextResponse.json({ error: "result_locked_requires_amendment", status: existing.status }, { status: 409 });
  }

  const configuredComponents = orderItem.test.components;
  const expected = configuredComponents.length > 0
    ? configuredComponents.map((component) => ({
        componentId: component.id,
        code: component.code,
        nameEn: component.nameEn,
        nameAr: component.nameAr,
        resultType: component.resultType,
        unitId: component.unitId,
        unitSnapshot: component.unit?.symbol || null,
        decimalPrecision: component.decimalPrecision,
      }))
    : [{
        componentId: null,
        code: orderItem.test.code,
        nameEn: orderItem.test.nameEn,
        nameAr: orderItem.test.nameAr,
        resultType: orderItem.test.resultType,
        unitId: orderItem.test.defaultUnitId,
        unitSnapshot: orderItem.test.defaultUnit?.symbol || null,
        decimalPrecision: orderItem.test.decimalPrecision,
      }];

  const valueByComponent = new Map((body.values || []).map((entry) => [entry.componentId || "__TEST__", entry.rawValue]));
  const prepared: Array<{
    componentId: string | null;
    code: string;
    nameEn: string;
    nameAr: string | null;
    resultType: "NUMERIC" | "TEXT" | "QUALITATIVE" | "BOOLEAN" | "DATE";
    unitId: string | null;
    unitSnapshot: string | null;
    parsed: NonNullable<ReturnType<typeof parseValue>>;
    interval: Awaited<ReturnType<typeof resolveReferenceInterval>> | null;
    flag: ReturnType<typeof numericFlag>;
    delta: Awaited<ReturnType<typeof evaluateDelta>>;
    isCalculated: boolean;
    calculatedRuleId: string | null;
    calculationExpression: string | null;
    calculationInputs: Record<string, string> | null;
  }> = [];
  const calculatedTargetIds = new Set(orderItem.test.calculatedRules.map(rule => rule.targetComponentId));

  try {
    for (const component of expected) {
      if (component.componentId && calculatedTargetIds.has(component.componentId)) continue;

      const raw = valueByComponent.get(component.componentId || "__TEST__");
      const parsed = parseValue(component.resultType, raw);
      if (!parsed) continue;

      const interval = component.componentId ? await resolveReferenceInterval(prisma, {
        componentId: component.componentId,
        branchId: performingBranchId,
        methodId: orderItem.test.methodId,
        patientSex: orderItem.order.patient.sexAtBirth,
        dateOfBirth: orderItem.order.patient.dateOfBirth,
      }) : null;

      const flag = parsed.valueNumeric !== null
        ? numericFlag(parsed.valueNumeric, interval)
        : { flag: "UNKNOWN" as const, isCritical: false };

      const delta = parsed.valueNumeric !== null
        ? await evaluateDelta(prisma, {
            organizationId: session.user.organizationId,
            patientId: orderItem.order.patientId,
            testId: orderItem.testId,
            componentId: component.componentId,
            performingBranchId,
            methodId: orderItem.test.methodId,
            currentValue: parsed.valueNumeric,
          })
        : {
            evaluation: "NOT_CONFIGURED" as const,
            previousValue: null,
            previousResultAt: null,
            deltaAbsolute: null,
            deltaPercent: null,
            absoluteLimit: null,
            percentLimit: null,
          };

      prepared.push({
        ...component,
        parsed,
        interval,
        flag,
        delta,
        isCalculated: false,
        calculatedRuleId: null,
        calculationExpression: null,
        calculationInputs: null,
      });
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("INVALID_")) {
      return NextResponse.json({ error: error.message.toLowerCase() }, { status: 400 });
    }
    throw error;
  }

  const complete = prepared.length === expected.length;
  const resultStatus = complete ? "ENTERED" : "DRAFT";

  const saved = await prisma.$transaction(async (tx) => {
    const result = existing
      ? await tx.laboratoryResult.update({
          where: { id: existing.id },
          data: {
            performingBranchId,
            methodId: orderItem.test.methodId,
            status: resultStatus,
            source: "MANUAL",
            enteredByUserId: session.user.id,
            enteredAt: new Date(),
            comments: comments || null,
          },
        })
      : await tx.laboratoryResult.create({
          data: {
            organizationId: session.user.organizationId,
            orderItemId,
            specimenId,
            performingBranchId,
            methodId: orderItem.test.methodId,
            version: 1,
            status: resultStatus,
            source: "MANUAL",
            enteredByUserId: session.user.id,
            comments: comments || null,
          },
        });

    if (existing) {
      await tx.laboratoryResultValue.deleteMany({ where: { resultId: result.id } });
    }

    for (const item of prepared) {
      await tx.laboratoryResultValue.create({
        data: {
          resultId: result.id,
          componentId: item.componentId,
          componentCodeSnapshot: item.code,
          componentNameEnSnapshot: item.nameEn,
          componentNameArSnapshot: item.nameAr,
          resultTypeSnapshot: item.resultType,
          valueNumeric: item.parsed.valueNumeric,
          valueText: item.parsed.valueText,
          valueBoolean: item.parsed.valueBoolean,
          valueDate: item.parsed.valueDate,
          displayValue: item.parsed.displayValue,
          unitId: item.unitId,
          unitSnapshot: item.unitSnapshot,
          referenceIntervalId: item.interval?.id || null,
          referenceLowSnapshot: item.interval?.lowValue || null,
          referenceHighSnapshot: item.interval?.highValue || null,
          referenceTextEnSnapshot: item.interval?.normalTextEn || null,
          referenceTextArSnapshot: item.interval?.normalTextAr || null,
          criticalLowSnapshot: item.interval?.criticalLow || null,
          criticalHighSnapshot: item.interval?.criticalHigh || null,
          flag: item.flag.flag,
          isCritical: item.flag.isCritical,
          deltaEvaluation: item.delta.evaluation,
          previousValueSnapshot: item.delta.previousValue,
          previousResultAtSnapshot: item.delta.previousResultAt,
          deltaAbsoluteSnapshot: item.delta.deltaAbsolute,
          deltaPercentSnapshot: item.delta.deltaPercent,
          deltaAbsoluteLimitSnapshot: item.delta.absoluteLimit,
          deltaPercentLimitSnapshot: item.delta.percentLimit,
        },
      });
    }

    await tx.orderItem.update({
      where: { id: orderItemId },
      data: {
        performedBranchId: performingBranchId,
        status: "IN_PROGRESS",
      },
    });

    if (specimen.status === "RECEIVED") {
      await tx.specimen.update({ where: { id: specimen.id }, data: { status: "IN_PROCESS" } });
      await tx.specimenEvent.create({
        data: {
          specimenId: specimen.id,
          eventType: "PROCESSING_STARTED",
          branchId: performingBranchId,
          actorUserId: session.user.id,
          fromStatus: "RECEIVED",
          toStatus: "IN_PROCESS",
          details: { orderItemId, testCode: orderItem.test.code },
        },
      });
    }

    if (["REGISTERED", "COLLECTED"].includes(orderItem.order.status)) {
      await tx.labOrder.update({ where: { id: orderItem.orderId }, data: { status: "IN_PROGRESS" } });
      await tx.orderStatusHistory.create({
        data: {
          orderId: orderItem.orderId,
          fromStatus: orderItem.order.status,
          toStatus: "IN_PROGRESS",
          reason: "Laboratory result entry started",
          changedByUserId: session.user.id,
        },
      });
    }

    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: performingBranchId,
        actorUserId: session.user.id,
        action: existing ? "RESULT_UPDATED" : "RESULT_ENTERED",
        entityType: "LaboratoryResult",
        entityId: result.id,
        oldValues: existing ? {
          status: existing.status,
          values: existing.values.map((value) => ({
            componentCode: value.componentCodeSnapshot,
            displayValue: value.displayValue,
            flag: value.flag,
          })),
        } : undefined,
        newValues: {
          status: resultStatus,
          orderItemId,
          specimenId,
          performingBranchId,
          testCode: orderItem.test.code,
          values: prepared.map((item) => ({
            componentCode: item.code,
            displayValue: item.parsed.displayValue,
            flag: item.flag.flag,
            critical: item.flag.isCritical,
            referenceIntervalId: item.interval?.id || null,
            deltaEvaluation: item.delta.evaluation,
            deltaAbsolute: item.delta.deltaAbsolute?.toString() || null,
            deltaPercent: item.delta.deltaPercent?.toString() || null,
          })),
        },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });

    return tx.laboratoryResult.findUnique({
      where: { id: result.id },
      include: { values: { orderBy: { componentCodeSnapshot: "asc" } } },
    });
  }, { timeout: 30000 });

  return NextResponse.json({
    status: "ok",
    result: saved,
    complete,
    criticalCount: saved?.values.filter((value) => value.isCritical).length || 0,
  }, { status: existing ? 200 : 201 });
}
