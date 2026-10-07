import { NextResponse } from "next/server";
import { Prisma } from "../../../../../../generated/prisma/client";
import { canAccessBranch, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { parseResultValue } from "@/lib/result-value-parser";
import { numericFlag, resolveReferenceInterval } from "@/lib/result-reference";
import { evaluateDelta } from "@/lib/delta-check";
import { evaluateFormula, formulaVariables } from "@/lib/formula-engine";
import { reflexMatches } from "@/lib/reflex-rules";
import { validationHoldMatches } from "@/lib/validation-holds";
import { evaluateAutoverification } from "@/lib/autoverification";
import { resolveAnalyzerQcGate } from "@/lib/qc-gate";
import { matchQualitativeOption, qualitativeFlag } from "@/lib/qualitative-result-options";

function emptyDelta() {
  return {
    evaluation: "NOT_CONFIGURED" as const,
    previousValue: null,
    previousResultAt: null,
    deltaAbsolute: null,
    deltaPercent: null,
    absoluteLimit: null,
    percentLimit: null,
  };
}

export async function POST(request: Request) {
  const session = await requirePermission("analyzers.import");
  const ctx = await requestContext();
  const body = await request.json().catch(() => null) as { importIds?: unknown } | null;
  const importIds = Array.isArray(body?.importIds)
    ? [...new Set(body.importIds.filter((value): value is string => typeof value === "string" && value.length <= 36))]
    : [];

  if (importIds.length === 0 || importIds.length > 200) {
    return NextResponse.json({ error: "invalid_import_selection" }, { status: 400 });
  }

  const imports = await prisma.analyzerResultImport.findMany({
    where: {
      id: { in: importIds },
      analyzer: { organizationId: session.user.organizationId },
    },
    include: {
      analyzer: true,
      mapping: true,
      specimen: true,
      orderItem: true,
    },
  });

  if (imports.length !== importIds.length) {
    return NextResponse.json({ error: "analyzer_import_not_found_or_forbidden" }, { status: 404 });
  }
  if (imports.some(item => item.status !== "MAPPED")) {
    return NextResponse.json({
      error: "only_mapped_observations_can_be_imported",
      invalid: imports.filter(item => item.status !== "MAPPED").map(item => ({ id: item.id, status: item.status })),
    }, { status: 409 });
  }

  const analyzerId = imports[0].analyzerId;
  const orderItemId = imports[0].orderItemId;
  const specimenId = imports[0].specimenId;

  if (!orderItemId || !specimenId || imports.some(item =>
    item.analyzerId !== analyzerId ||
    item.orderItemId !== orderItemId ||
    item.specimenId !== specimenId
  )) {
    return NextResponse.json({ error: "imports_must_target_one_analyzer_order_item_and_specimen" }, { status: 409 });
  }

  const analyzer = imports[0].analyzer;
  const now = new Date();
  if (!canAccessBranch(session, analyzer.branchId)) {
    return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });
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
            include: {
              unit: true,
              qualitativeResultOptions: {
                where: {
                  status: "ACTIVE",
                  effectiveFrom: { lte: now },
                  OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }],
                },
                orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }],
              },
            },
            orderBy: [{ displayOrder: "asc" }, { code: "asc" }],
          },
          qualitativeResultOptions: {
            where: {
              componentId: null,
              status: "ACTIVE",
              effectiveFrom: { lte: now },
              OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }],
            },
            orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }],
          },
          calculatedRules: {
            where: {
              status: "ACTIVE",
              effectiveFrom: { lte: now },
              OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }],
            },
            include: { targetComponent: true },
          },
          sourceReflexRules: {
            where: {
              status: "ACTIVE",
              effectiveFrom: { lte: now },
              OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }],
            },
            include: { targetTest: true },
          },
          validationHoldRules: {
            where: {
              status: "ACTIVE",
              effectiveFrom: { lte: now },
              AND: [
                { OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }] },
                { OR: [{ branchId: null }, { branchId: analyzer.branchId }] },
              ],
            },
            orderBy: { createdAt: "asc" },
          },
          autoverificationPolicies: {
            where: {
              status: "ACTIVE",
              effectiveFrom: { lte: now },
              AND: [
                { OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }] },
                { OR: [{ branchId: null }, { branchId: analyzer.branchId }] },
              ],
            },
            orderBy: { createdAt: "desc" },
          },
        },
      },
      specimenLinks: {
        where: { specimenId, status: "ACTIVE" },
        include: { specimen: true },
      },
      results: {
        orderBy: { version: "desc" },
        take: 1,
        include: { values: true },
      },
    },
  });

  if (!orderItem) return NextResponse.json({ error: "order_item_not_found" }, { status: 404 });
  const specimen = orderItem.specimenLinks[0]?.specimen;
  if (!specimen) return NextResponse.json({ error: "specimen_not_linked_to_order_item" }, { status: 409 });
  if (specimen.currentBranchId !== analyzer.branchId) {
    return NextResponse.json({ error: "specimen_analyzer_branch_mismatch" }, { status: 409 });
  }
  if (!["RECEIVED","IN_PROCESS"].includes(specimen.status)) {
    return NextResponse.json({ error: "specimen_not_ready_for_analyzer_import", status: specimen.status }, { status: 409 });
  }

  for (const item of imports) {
    if (!item.mapping || item.mapping.testId !== orderItem.testId || item.mapping.analyzerId !== analyzer.id) {
      return NextResponse.json({ error: "staged_mapping_no_longer_matches_order_item", importId: item.id }, { status: 409 });
    }
  }

  const existing = orderItem.results[0] || null;
  if (existing && ["VERIFIED","RELEASED","AMENDED","CANCELLED"].includes(existing.status)) {
    return NextResponse.json({ error: "result_locked_requires_explicit_workflow", resultId: existing.id, status: existing.status }, { status: 409 });
  }
  if (existing && existing.source !== "ANALYZER") {
    return NextResponse.json({
      error: "result_source_conflict_requires_explicit_workflow",
      resultId: existing.id,
      source: existing.source,
      status: existing.status,
    }, { status: 409 });
  }
  if (existing && (
    existing.analyzerId !== analyzer.id ||
    existing.specimenId !== specimen.id ||
    existing.performingBranchId !== analyzer.branchId
  )) {
    return NextResponse.json({ error: "existing_analyzer_result_context_mismatch", resultId: existing.id }, { status: 409 });
  }

  const components = orderItem.test.components;
  const expected = components.length > 0
    ? components.map(component => ({
        componentId: component.id,
        code: component.code,
        nameEn: component.nameEn,
        nameAr: component.nameAr,
        resultType: component.resultType,
        unitId: component.unitId,
        unitSnapshot: component.unit?.symbol || null,
        decimalPrecision: component.decimalPrecision,
        qualitativeOptions: component.qualitativeResultOptions,
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
        qualitativeOptions: orderItem.test.qualitativeResultOptions,
      }];

  const calculatedTargetIds = new Set(orderItem.test.calculatedRules.map(rule => rule.targetComponentId));
  const definitionsById = new Map(expected.filter(item => item.componentId).map(item => [item.componentId!, item]));
  const simpleDefinition = components.length === 0 ? expected[0] : null;

  const targetKeys = imports.map(item => item.mapping!.componentId || "__TEST__");
  if (new Set(targetKeys).size !== targetKeys.length) {
    return NextResponse.json({ error: "multiple_observations_target_same_result_component" }, { status: 409 });
  }
  if (imports.some(item => item.mapping!.componentId && calculatedTargetIds.has(item.mapping!.componentId))) {
    return NextResponse.json({ error: "analyzer_import_cannot_target_calculated_component" }, { status: 409 });
  }

  type PreparedValue = {
    componentId: string | null;
    code: string;
    nameEn: string;
    nameAr: string | null;
    resultType: "NUMERIC" | "TEXT" | "QUALITATIVE" | "BOOLEAN" | "DATE";
    unitId: string | null;
    unitSnapshot: string | null;
    parsed: NonNullable<ReturnType<typeof parseResultValue>>;
    interval: Awaited<ReturnType<typeof resolveReferenceInterval>> | null;
    flag: ReturnType<typeof numericFlag>;
    delta: Awaited<ReturnType<typeof evaluateDelta>>;
    isCalculated: boolean;
    calculatedRuleId: string | null;
    calculationExpression: string | null;
    calculationInputs: Record<string, string> | null;
    analyzerImportId: string | null;
    flagSource: "NONE" | "REFERENCE_INTERVAL" | "RESULT_OPTION" | "ANALYZER" | "MANUAL";
    qualitativeOptionId: string | null;
    qualitativeOptionCode: string | null;
    valueTextEnSnapshot: string | null;
    valueTextArSnapshot: string | null;
  };

  const incoming: PreparedValue[] = [];
  try {
    for (const staged of imports) {
      const definition = staged.mapping!.componentId
        ? definitionsById.get(staged.mapping!.componentId)
        : simpleDefinition;

      if (!definition) {
        return NextResponse.json({
          error: "mapped_component_not_active_or_simple_test_mismatch",
          importId: staged.id,
        }, { status: 409 });
      }

      const selectedOption = definition.resultType === "QUALITATIVE" && definition.qualitativeOptions.length > 0
        ? matchQualitativeOption(definition.qualitativeOptions.map(option => ({
            id: option.id,
            testId: option.testId,
            componentId: option.componentId,
            code: option.code,
            valueEn: option.valueEn,
            valueAr: option.valueAr,
            flag: option.flag as "NORMAL" | "ABNORMAL" | "POSITIVE" | "NEGATIVE" | "UNKNOWN",
            isCritical: option.isCritical,
          })), staged.rawValue)
        : null;

      if (definition.resultType === "QUALITATIVE" && definition.qualitativeOptions.length > 0 && !selectedOption) {
        return NextResponse.json({
          error: "analyzer_qualitative_option_not_mapped",
          importId: staged.id,
          analyzerTestCode: staged.analyzerTestCode,
        }, { status: 409 });
      }

      const parsed = parseResultValue(definition.resultType, selectedOption ? selectedOption.valueEn : staged.rawValue);
      if (!parsed) {
        return NextResponse.json({ error: "empty_analyzer_result_value", importId: staged.id }, { status: 400 });
      }

      const interval = definition.componentId
        ? await resolveReferenceInterval(prisma, {
            componentId: definition.componentId,
            branchId: analyzer.branchId,
            methodId: orderItem.test.methodId,
            patientSex: orderItem.order.patient.sexAtBirth,
            dateOfBirth: orderItem.order.patient.dateOfBirth,
          })
        : null;

      const flag = selectedOption
        ? qualitativeFlag(selectedOption)
        : parsed.valueNumeric !== null
          ? numericFlag(parsed.valueNumeric, interval)
          : { flag: "UNKNOWN" as const, isCritical: false };
      const flagSource = selectedOption
        ? "RESULT_OPTION" as const
        : parsed.valueNumeric !== null && interval
          ? "REFERENCE_INTERVAL" as const
          : "NONE" as const;

      const delta = parsed.valueNumeric !== null
        ? await evaluateDelta(prisma, {
            organizationId: session.user.organizationId,
            patientId: orderItem.order.patientId,
            testId: orderItem.testId,
            componentId: definition.componentId,
            performingBranchId: analyzer.branchId,
            methodId: orderItem.test.methodId,
            currentValue: parsed.valueNumeric,
          })
        : emptyDelta();

      incoming.push({
        ...definition,
        parsed,
        interval,
        flag,
        delta,
        isCalculated: false,
        calculatedRuleId: null,
        calculationExpression: null,
        calculationInputs: null,
        analyzerImportId: staged.id,
        flagSource,
        qualitativeOptionId: selectedOption?.id || null,
        qualitativeOptionCode: selectedOption?.code || null,
        valueTextEnSnapshot: selectedOption?.valueEn || null,
        valueTextArSnapshot: selectedOption?.valueAr || null,
      });
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("INVALID_")) {
      return NextResponse.json({ error: error.message.toLowerCase() }, { status: 400 });
    }
    throw error;
  }

  const existingDirect = (existing?.values || []).filter(value => !value.isCalculated);
  const incomingCodes = new Set(incoming.map(item => item.code));
  const finalDirect = new Map<string, {
    componentId: string | null;
    code: string;
    valueNumeric: Prisma.Decimal | null;
    valueText: string | null;
    displayValue: string;
    flag: "NORMAL" | "LOW" | "HIGH" | "CRITICAL_LOW" | "CRITICAL_HIGH" | "ABNORMAL" | "POSITIVE" | "NEGATIVE" | "UNKNOWN";
    isCritical: boolean;
    deltaEvaluation: "NOT_CONFIGURED" | "NO_PREVIOUS_RESULT" | "WITHIN_LIMIT" | "EXCEEDED";
  }>();

  for (const value of existingDirect) {
    if (incomingCodes.has(value.componentCodeSnapshot)) continue;
    finalDirect.set(value.componentCodeSnapshot, {
      componentId: value.componentId,
      code: value.componentCodeSnapshot,
      valueNumeric: value.valueNumeric,
      valueText: value.valueText,
      displayValue: value.displayValue,
      flag: value.flag,
      isCritical: value.isCritical,
      deltaEvaluation: value.deltaEvaluation,
    });
  }
  for (const item of incoming) {
    finalDirect.set(item.code, {
      componentId: item.componentId,
      code: item.code,
      valueNumeric: item.parsed.valueNumeric,
      valueText: item.parsed.valueText,
      displayValue: item.parsed.displayValue,
      flag: item.flag.flag,
      isCritical: item.flag.isCritical,
      deltaEvaluation: item.delta.evaluation,
    });
  }

  const numericInputs: Record<string, Prisma.Decimal> = {};
  for (const item of finalDirect.values()) {
    if (item.valueNumeric !== null) numericInputs[item.code.toUpperCase()] = new Prisma.Decimal(item.valueNumeric);
  }

  const calculated: PreparedValue[] = [];
  try {
    for (const rule of orderItem.test.calculatedRules) {
      const target = expected.find(item => item.componentId === rule.targetComponentId);
      if (!target) continue;

      const variables = formulaVariables(rule.expression);
      if (variables.some(variable => numericInputs[variable] === undefined)) continue;

      const calculationInputs = Object.fromEntries(
        variables.map(variable => [variable, numericInputs[variable].toString()]),
      );
      const precision = rule.decimalPrecision ?? target.decimalPrecision ?? 4;
      const value = evaluateFormula(rule.expression, numericInputs).toDecimalPlaces(precision);
      const parsed = {
        valueNumeric: value,
        valueText: null,
        valueBoolean: null,
        valueDate: null,
        displayValue: value.toFixed(precision),
      };

      const interval = await resolveReferenceInterval(prisma, {
        componentId: rule.targetComponentId,
        branchId: analyzer.branchId,
        methodId: orderItem.test.methodId,
        patientSex: orderItem.order.patient.sexAtBirth,
        dateOfBirth: orderItem.order.patient.dateOfBirth,
      });
      const flag = numericFlag(value, interval);
      const delta = await evaluateDelta(prisma, {
        organizationId: session.user.organizationId,
        patientId: orderItem.order.patientId,
        testId: orderItem.testId,
        componentId: rule.targetComponentId,
        performingBranchId: analyzer.branchId,
        methodId: orderItem.test.methodId,
        currentValue: value,
      });

      calculated.push({
        ...target,
        parsed,
        interval,
        flag,
        delta,
        isCalculated: true,
        calculatedRuleId: rule.id,
        calculationExpression: rule.expression,
        calculationInputs,
        analyzerImportId: null,
        flagSource: interval ? "REFERENCE_INTERVAL" : "NONE",
        qualitativeOptionId: null,
        qualitativeOptionCode: null,
        valueTextEnSnapshot: null,
        valueTextArSnapshot: null,
      });
      numericInputs[target.code.toUpperCase()] = value;
    }
  } catch (error) {
    if (error instanceof Error && (
      error.message.startsWith("FORMULA_") ||
      error.message.startsWith("MISSING_FORMULA_") ||
      error.message.startsWith("UNEXPECTED_FORMULA_") ||
      error.message.startsWith("TRAILING_FORMULA_")
    )) {
      return NextResponse.json({ error: "calculated_result_failed", detail: error.message }, { status: 409 });
    }
    throw error;
  }

  const ruleValues = new Map<string, {
    componentId: string | null;
    numericValue: Prisma.Decimal | null;
    textValue: string | null;
    displayValue: string;
    flag: "NORMAL" | "LOW" | "HIGH" | "CRITICAL_LOW" | "CRITICAL_HIGH" | "ABNORMAL" | "POSITIVE" | "NEGATIVE" | "UNKNOWN";
    isCritical: boolean;
    deltaEvaluation: "NOT_CONFIGURED" | "NO_PREVIOUS_RESULT" | "WITHIN_LIMIT" | "EXCEEDED";
  }>();

  for (const item of finalDirect.values()) {
    ruleValues.set(item.code, {
      componentId: item.componentId,
      numericValue: item.valueNumeric,
      textValue: item.valueText,
      displayValue: item.displayValue,
      flag: item.flag,
      isCritical: item.isCritical,
      deltaEvaluation: item.deltaEvaluation,
    });
  }
  for (const item of calculated) {
    ruleValues.set(item.code, {
      componentId: item.componentId,
      numericValue: item.parsed.valueNumeric,
      textValue: item.parsed.valueText,
      displayValue: item.parsed.displayValue,
      flag: item.flag.flag,
      isCritical: item.flag.isCritical,
      deltaEvaluation: item.delta.evaluation,
    });
  }

  const finalCodes = new Set(ruleValues.keys());
  const complete = expected.every(item => finalCodes.has(item.code));
  const resultStatus = complete ? "ENTERED" : "DRAFT";
  const autoverificationPolicy =
    orderItem.test.autoverificationPolicies.find(policy => policy.branchId === analyzer.branchId)
    || orderItem.test.autoverificationPolicies.find(policy => policy.branchId === null)
    || null;

  const saved = await prisma.$transaction(async tx => {
    if (specimen.status === "RECEIVED") {
      const claimed = await tx.specimen.updateMany({
        where: {
          id: specimen.id,
          status: "RECEIVED",
          currentBranchId: analyzer.branchId,
          preanalyticalVersion: specimen.preanalyticalVersion,
          orderItems: { some: { orderItemId: orderItem.id, status: "ACTIVE" } },
        },
        data: {
          status: "IN_PROCESS",
          preanalyticalVersion: { increment: 1 },
        },
      });
      if (claimed.count !== 1) throw new Error("SPECIMEN_PREANALYTICAL_STATE_CHANGED");
    }

    const stillMapped = await tx.analyzerResultImport.count({
      where: { id: { in: importIds }, status: "MAPPED" },
    });
    if (stillMapped !== importIds.length) throw new Error("ANALYZER_IMPORT_CONCURRENT_STATE_CHANGE");

    const result = existing
      ? await tx.laboratoryResult.update({
          where: { id: existing.id },
          data: {
            specimenId: specimen.id,
            performingBranchId: analyzer.branchId,
            methodId: orderItem.test.methodId,
            analyzerId: analyzer.id,
            analyzerCodeSnapshot: analyzer.code,
            analyzerNameSnapshot: analyzer.name,
            status: resultStatus,
            source: "ANALYZER",
            enteredByUserId: session.user.id,
            enteredAt: new Date(),
            autoVerified: false,
            verifiedByUserId: null,
            verifiedAt: null,
          },
        })
      : await tx.laboratoryResult.create({
          data: {
            organizationId: session.user.organizationId,
            orderItemId: orderItem.id,
            specimenId: specimen.id,
            performingBranchId: analyzer.branchId,
            methodId: orderItem.test.methodId,
            analyzerId: analyzer.id,
            analyzerCodeSnapshot: analyzer.code,
            analyzerNameSnapshot: analyzer.name,
            version: 1,
            status: resultStatus,
            source: "ANALYZER",
            enteredByUserId: session.user.id,
          },
        });

    if (existing) {
      await tx.laboratoryResultValue.deleteMany({
        where: { resultId: result.id, isCalculated: true },
      });
    }

    for (const item of incoming) {
      await tx.laboratoryResultValue.upsert({
        where: {
          resultId_componentCodeSnapshot: {
            resultId: result.id,
            componentCodeSnapshot: item.code,
          },
        },
        update: {
          componentId: item.componentId,
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
          flagSource: item.flagSource,
          isCritical: item.flag.isCritical,
          qualitativeOptionId: item.qualitativeOptionId,
          qualitativeOptionCodeSnapshot: item.qualitativeOptionCode,
          valueTextEnSnapshot: item.valueTextEnSnapshot,
          valueTextArSnapshot: item.valueTextArSnapshot,
          deltaEvaluation: item.delta.evaluation,
          previousValueSnapshot: item.delta.previousValue,
          previousResultAtSnapshot: item.delta.previousResultAt,
          deltaAbsoluteSnapshot: item.delta.deltaAbsolute,
          deltaPercentSnapshot: item.delta.deltaPercent,
          deltaAbsoluteLimitSnapshot: item.delta.absoluteLimit,
          deltaPercentLimitSnapshot: item.delta.percentLimit,
          isCalculated: false,
          calculatedRuleId: null,
          calculationExpressionSnapshot: null,
          calculationInputsSnapshot: Prisma.DbNull,
          analyzerImportId: item.analyzerImportId,
        },
        create: {
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
          flagSource: item.flagSource,
          isCritical: item.flag.isCritical,
          qualitativeOptionId: item.qualitativeOptionId,
          qualitativeOptionCodeSnapshot: item.qualitativeOptionCode,
          valueTextEnSnapshot: item.valueTextEnSnapshot,
          valueTextArSnapshot: item.valueTextArSnapshot,
          deltaEvaluation: item.delta.evaluation,
          previousValueSnapshot: item.delta.previousValue,
          previousResultAtSnapshot: item.delta.previousResultAt,
          deltaAbsoluteSnapshot: item.delta.deltaAbsolute,
          deltaPercentSnapshot: item.delta.deltaPercent,
          deltaAbsoluteLimitSnapshot: item.delta.absoluteLimit,
          deltaPercentLimitSnapshot: item.delta.percentLimit,
          analyzerImportId: item.analyzerImportId,
        },
      });
    }

    for (const item of calculated) {
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
          flagSource: item.flagSource,
          isCritical: item.flag.isCritical,
          qualitativeOptionId: item.qualitativeOptionId,
          qualitativeOptionCodeSnapshot: item.qualitativeOptionCode,
          valueTextEnSnapshot: item.valueTextEnSnapshot,
          valueTextArSnapshot: item.valueTextArSnapshot,
          deltaEvaluation: item.delta.evaluation,
          previousValueSnapshot: item.delta.previousValue,
          previousResultAtSnapshot: item.delta.previousResultAt,
          deltaAbsoluteSnapshot: item.delta.deltaAbsolute,
          deltaPercentSnapshot: item.delta.deltaPercent,
          deltaAbsoluteLimitSnapshot: item.delta.absoluteLimit,
          deltaPercentLimitSnapshot: item.delta.percentLimit,
          isCalculated: true,
          calculatedRuleId: item.calculatedRuleId,
          calculationExpressionSnapshot: item.calculationExpression,
          calculationInputsSnapshot: item.calculationInputs ? item.calculationInputs as Prisma.InputJsonValue : undefined,
          analyzerImportId: null,
        },
      });
    }

    for (const rule of orderItem.test.sourceReflexRules) {
      if (rule.branchId && rule.branchId !== analyzer.branchId) continue;
      const source = [...ruleValues.values()].find(item =>
        rule.sourceComponentId ? item.componentId === rule.sourceComponentId : item.componentId === null
      );
      if (!source) continue;

      const matched = reflexMatches(
        rule.operator,
        {
          numericValue: source.numericValue,
          textValue: source.textValue,
          displayValue: source.displayValue,
        },
        {
          numericThreshold: rule.numericThreshold,
          textThreshold: rule.textThreshold,
        },
      );

      if (matched) {
        await tx.reflexRuleEvent.upsert({
          where: { resultId_ruleId: { resultId: result.id, ruleId: rule.id } },
          update: {
            status: "PENDING",
            triggerValueSnapshot: source.displayValue,
            targetTestCodeSnapshot: rule.targetTest.code,
            targetTestNameEnSnapshot: rule.targetTest.nameEn,
            targetTestNameArSnapshot: rule.targetTest.nameAr,
            reviewedByUserId: null,
            reviewedAt: null,
            reviewNote: null,
          },
          create: {
            resultId: result.id,
            ruleId: rule.id,
            triggerValueSnapshot: source.displayValue,
            targetTestCodeSnapshot: rule.targetTest.code,
            targetTestNameEnSnapshot: rule.targetTest.nameEn,
            targetTestNameArSnapshot: rule.targetTest.nameAr,
          },
        });
      } else {
        await tx.reflexRuleEvent.updateMany({
          where: { resultId: result.id, ruleId: rule.id, status: "PENDING" },
          data: { status: "SUPERSEDED" },
        });
      }
    }

    const holdValues = [...ruleValues.values()].map(item => ({
      flag: item.flag,
      isCritical: item.isCritical,
      deltaEvaluation: item.deltaEvaluation,
    }));

    for (const rule of orderItem.test.validationHoldRules) {
      const matched = validationHoldMatches(rule, { source: "ANALYZER", values: holdValues });
      if (matched) {
        await tx.validationHoldEvent.upsert({
          where: { resultId_ruleId: { resultId: result.id, ruleId: rule.id } },
          update: {
            status: "ACTIVE",
            severitySnapshot: rule.severity,
            reasonEnSnapshot: rule.reasonEn,
            reasonArSnapshot: rule.reasonAr,
            reviewedByUserId: null,
            reviewedAt: null,
            reviewNote: null,
          },
          create: {
            resultId: result.id,
            ruleId: rule.id,
            severitySnapshot: rule.severity,
            reasonEnSnapshot: rule.reasonEn,
            reasonArSnapshot: rule.reasonAr,
          },
        });
      } else {
        await tx.validationHoldEvent.updateMany({
          where: { resultId: result.id, ruleId: rule.id, status: "ACTIVE" },
          data: { status: "SUPERSEDED" },
        });
      }
    }

    const [pendingReflexCount, blockingHoldCount] = await Promise.all([
      tx.reflexRuleEvent.count({ where: { resultId: result.id, status: "PENDING" } }),
      tx.validationHoldEvent.count({ where: { resultId: result.id, status: "ACTIVE", severitySnapshot: "BLOCK" } }),
    ]);

    const qcGate = await resolveAnalyzerQcGate(tx, {
      analyzerId: analyzer.id,
      testId: orderItem.testId,
      componentIds: [...finalDirect.values()].map(value => value.componentId),
      asOf: new Date(),
    });

    const decision = evaluateAutoverification({
      policy: autoverificationPolicy,
      source: "ANALYZER",
      complete,
      values: holdValues,
      pendingReflexCount,
      blockingHoldCount,
      qcGate,
    });
    const finalResultStatus = decision.eligible ? "VERIFIED" : resultStatus;
    const autoverifiedAt = decision.eligible ? new Date() : null;

    await tx.laboratoryResult.update({
      where: { id: result.id },
      data: {
        status: finalResultStatus,
        autoVerified: decision.eligible,
        autoverificationPolicyId: decision.policyId,
        autoverificationDecisionSnapshot: decision as Prisma.InputJsonValue,
        verifiedByUserId: null,
        verifiedAt: autoverifiedAt,
      },
    });

    const importedAt = new Date();
    await tx.analyzerResultImport.updateMany({
      where: { id: { in: importIds }, status: "MAPPED" },
      data: { status: "IMPORTED", resultId: result.id, importedAt, errorCode: null, errorText: null },
    });

    await tx.orderItem.update({
      where: { id: orderItem.id },
      data: {
        performedBranchId: analyzer.branchId,
        status: decision.eligible ? "VERIFIED" : "IN_PROGRESS",
      },
    });

    if (specimen.status === "RECEIVED") {
      await tx.specimenEvent.create({
        data: {
          specimenId: specimen.id,
          eventType: "PROCESSING_STARTED",
          branchId: analyzer.branchId,
          actorUserId: session.user.id,
          fromStatus: "RECEIVED",
          toStatus: "IN_PROCESS",
          details: { orderItemId: orderItem.id, testCode: orderItem.test.code, analyzerId: analyzer.id, analyzerCode: analyzer.code },
        },
      });
    }

    const remainingOrderItems = decision.eligible
      ? await tx.orderItem.count({
          where: {
            orderId: orderItem.orderId,
            status: { notIn: ["VERIFIED", "CANCELLED"] },
          },
        })
      : null;

    if (decision.eligible && remainingOrderItems === 0) {
      const currentOrder = await tx.labOrder.findUnique({ where: { id: orderItem.orderId }, select: { status: true } });
      if (currentOrder && currentOrder.status !== "COMPLETED") {
        await tx.labOrder.update({ where: { id: orderItem.orderId }, data: { status: "COMPLETED" } });
        await tx.orderStatusHistory.create({
          data: {
            orderId: orderItem.orderId,
            fromStatus: currentOrder.status,
            toStatus: "COMPLETED",
            reason: "All non-cancelled order items verified; analyzer result autoverified with QC pass",
            changedByUserId: session.user.id,
          },
        });
      }
    } else if (["REGISTERED","COLLECTED"].includes(orderItem.order.status)) {
      await tx.labOrder.update({ where: { id: orderItem.orderId }, data: { status: "IN_PROGRESS" } });
      await tx.orderStatusHistory.create({
        data: {
          orderId: orderItem.orderId,
          fromStatus: orderItem.order.status,
          toStatus: "IN_PROGRESS",
          reason: "Analyzer result import started",
          changedByUserId: session.user.id,
        },
      });
    }

    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: analyzer.branchId,
        actorUserId: session.user.id,
        action: existing ? "ANALYZER_RESULT_UPDATED" : "ANALYZER_RESULT_IMPORTED",
        entityType: "LaboratoryResult",
        entityId: result.id,
        oldValues: existing ? {
          status: existing.status,
          analyzerId: existing.analyzerId,
          values: existing.values.map(value => ({
            componentCode: value.componentCodeSnapshot,
            displayValue: value.displayValue,
            analyzerImportId: value.analyzerImportId,
          })),
        } : undefined,
        newValues: {
          status: finalResultStatus,
          analyzerId: analyzer.id,
          analyzerCode: analyzer.code,
          specimenId: specimen.id,
          importIds,
          complete,
          autoverificationEligible: decision.eligible,
          autoverificationReasons: decision.reasons,
          qcGateStatus: qcGate.status,
          qcGateReasons: qcGate.reasons,
          values: incoming.map(item => ({
            componentCode: item.code,
            displayValue: item.parsed.displayValue,
            flag: item.flag.flag,
            analyzerImportId: item.analyzerImportId,
          })),
        },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });

    if (decision.eligible) {
      await tx.auditEvent.create({
        data: {
          organizationId: session.user.organizationId,
          branchId: analyzer.branchId,
          actorUserId: session.user.id,
          action: "RESULT_AUTOVERIFIED",
          entityType: "LaboratoryResult",
          entityId: result.id,
          oldValues: { status: resultStatus },
          newValues: {
            status: "VERIFIED",
            verifiedAt: autoverifiedAt,
            policyId: decision.policyId,
            analyzerId: analyzer.id,
            qcGateStatus: qcGate.status,
            qcGateReasons: qcGate.reasons,
          },
          reason: "Analyzer result met all autoverification rules and QC gate passed",
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
      });
    }

    return tx.laboratoryResult.findUnique({
      where: { id: result.id },
      include: {
        values: { orderBy: { componentCodeSnapshot: "asc" } },
        reflexEvents: true,
        validationHoldEvents: true,
      },
    });
  }, { timeout: 30000, isolationLevel: "Serializable" }).catch(error => {
    if (error instanceof Error && ["ANALYZER_IMPORT_CONCURRENT_STATE_CHANGE","SPECIMEN_PREANALYTICAL_STATE_CHANGED"].includes(error.message)) return null;
    throw error;
  });

  if (!saved) {
    return NextResponse.json({ error: "analyzer_import_state_changed_retry" }, { status: 409 });
  }

  return NextResponse.json({
    status: "ok",
    result: saved,
    complete,
    importedObservationCount: importIds.length,
    criticalCount: saved?.values.filter(value => value.isCritical).length || 0,
    deltaExceededCount: saved?.values.filter(value => value.deltaEvaluation === "EXCEEDED").length || 0,
    pendingReflexCount: saved?.reflexEvents.filter(event => event.status === "PENDING").length || 0,
    blockingValidationHoldCount: saved?.validationHoldEvents.filter(event => event.status === "ACTIVE" && event.severitySnapshot === "BLOCK").length || 0,
    autoVerified: saved?.autoVerified || false,
    autoverificationDecision: saved?.autoverificationDecisionSnapshot || null,
  }, { status: existing ? 200 : 201 });
}
