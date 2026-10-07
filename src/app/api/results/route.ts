import { NextResponse } from "next/server";
import { Prisma } from "../../../../generated/prisma/client";
import { canAccessBranch, canAccessDepartment, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { numericFlag, resolveReferenceInterval } from "@/lib/result-reference";
import { evaluateDelta } from "@/lib/delta-check";
import { syncDeltaReviewEvents } from "@/lib/delta-review";
import { evaluateFormula, formulaVariables } from "@/lib/formula-engine";
import { reflexMatches } from "@/lib/reflex-rules";
import { evaluateAutoverification } from "@/lib/autoverification";
import { validationHoldMatches } from "@/lib/validation-holds";
import { parseResultValue } from "@/lib/result-value-parser";
import { qualitativeFlag } from "@/lib/qualitative-result-options";
import { resolveResultValueComment } from "@/lib/result-comments";
import { automatedTechnicalReviewOutcome, selectValidationPolicy, snapshotValidationPolicy, type ValidationPolicySnapshot } from "@/lib/result-validation";

function text(value: unknown, max = 5000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function POST(request: Request) {
  const session = await requirePermission("results.enter");
  const ctx = await requestContext();
  const body = await request.json().catch(() => null) as {
    orderItemId?: string;
    specimenId?: string;
    performingBranchId?: string;
    comments?: string;
    values?: Array<{ componentId?: string | null; rawValue?: unknown; resultOptionId?: string | null; comments?: unknown }>;
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
          autoverificationPolicies: {
            where: {
              status: "ACTIVE",
              effectiveFrom: { lte: new Date() },
              AND: [
                { OR: [{ effectiveTo: null }, { effectiveTo: { gte: new Date() } }] },
                { OR: [{ branchId: null }, { branchId: performingBranchId }] },
              ],
            },
            orderBy: { createdAt: "desc" },
          },
          validationHoldRules: {
            where: {
              status: "ACTIVE",
              effectiveFrom: { lte: new Date() },
              AND: [
                { OR: [{ effectiveTo: null }, { effectiveTo: { gte: new Date() } }] },
                { OR: [{ branchId: null }, { branchId: performingBranchId }] },
              ],
            },
            orderBy: { createdAt: "asc" },
          },
        },
      },
      specimenLinks: {
        where: { specimenId, status: "ACTIVE" },
        include: { specimen: true },
      },
      results: { orderBy: { version: "desc" }, take: 1, include: { values: true } },
    },
  });

  if (!orderItem) return NextResponse.json({ error: "order_item_not_found" }, { status: 404 });
  if (!canAccessDepartment(session, orderItem.test.departmentId)) return NextResponse.json({ error: "department_forbidden" }, { status: 403 });

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
  if (existing && ["MEDICAL_VALIDATION", "COMPLETE"].includes(existing.validationStage)) {
    return NextResponse.json({ error: "result_locked_by_validation_stage", validationStage: existing.validationStage }, { status: 409 });
  }
  if (existing && existing.source !== "MANUAL") {
    return NextResponse.json({
      error: "result_source_conflict_requires_explicit_workflow",
      source: existing.source,
      status: existing.status,
    }, { status: 409 });
  }

  const resultSource = "MANUAL" as const;
  const resultAt = new Date();
  const validationPolicies = await prisma.resultValidationPolicy.findMany({
    where: {
      organizationId: session.user.organizationId,
      status: "ACTIVE",
      effectiveFrom: { lte: resultAt },
      AND: [
        { OR: [{ effectiveTo: null }, { effectiveTo: { gte: resultAt } }] },
        { OR: [{ branchId: null }, { branchId: performingBranchId }] },
      ],
    },
  });
  const selectedValidationPolicy = selectValidationPolicy(validationPolicies, {
    branchId: performingBranchId,
    testId: orderItem.testId,
    departmentId: orderItem.test.departmentId,
  });
  const configuredValidationSnapshot = snapshotValidationPolicy(selectedValidationPolicy);

  const qualitativeOptions = await prisma.qualitativeResultOption.findMany({
    where: {
      organizationId: session.user.organizationId,
      testId: orderItem.testId,
      status: "ACTIVE",
      approvalStatus: "APPROVED",
      approvedAt: { not: null },
      effectiveFrom: { lte: resultAt },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: resultAt } }],
    },
    orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }],
  });

  const autoverificationPolicy =
    orderItem.test.autoverificationPolicies.find(policy => policy.branchId === performingBranchId)
    || orderItem.test.autoverificationPolicies.find(policy => policy.branchId === null)
    || null;

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

  const valueByComponent = new Map((body.values || []).map((entry) => [entry.componentId || "__TEST__", entry]));
  const existingValueByComponent = new Map((existing?.values || []).map((value) => [value.componentId || "__TEST__", value]));
  const prepared: Array<{
    componentId: string | null;
    code: string;
    nameEn: string;
    nameAr: string | null;
    resultType: "NUMERIC" | "TEXT" | "QUALITATIVE" | "BOOLEAN" | "DATE";
    unitId: string | null;
    unitSnapshot: string | null;
    parsed: NonNullable<ReturnType<typeof parseResultValue>>;
    interval: Awaited<ReturnType<typeof resolveReferenceInterval>> | null;
    flag: {
      flag: "NORMAL" | "LOW" | "HIGH" | "CRITICAL_LOW" | "CRITICAL_HIGH" | "ABNORMAL" | "POSITIVE" | "NEGATIVE" | "UNKNOWN";
      isAbnormal: boolean;
      isCritical: boolean;
    };
    delta: Awaited<ReturnType<typeof evaluateDelta>>;
    isCalculated: boolean;
    calculatedRuleId: string | null;
    calculationExpression: string | null;
    calculationInputs: Record<string, string> | null;
    flagSource: "NONE" | "REFERENCE_INTERVAL" | "RESULT_OPTION" | "ANALYZER" | "MANUAL";
    qualitativeOptionId: string | null;
    qualitativeOptionCode: string | null;
    valueTextEnSnapshot: string | null;
    valueTextArSnapshot: string | null;
    comments: string | null;
  }> = [];
  const calculatedTargetIds = new Set(orderItem.test.calculatedRules.map(rule => rule.targetComponentId));

  try {
    for (const component of expected) {
      if (component.componentId && calculatedTargetIds.has(component.componentId)) continue;

      const key = component.componentId || "__TEST__";
      const entry = valueByComponent.get(key);
      const raw = entry?.rawValue;
      const componentComment = resolveResultValueComment(entry, existingValueByComponent.get(key)?.comments);
      const fieldOptions = component.resultType === "QUALITATIVE"
        ? qualitativeOptions.filter((option) => option.componentId === component.componentId)
        : [];
      const selectedOption = entry?.resultOptionId
        ? fieldOptions.find((option) => option.id === entry.resultOptionId) || null
        : null;

      if (entry?.resultOptionId && !selectedOption) {
        return NextResponse.json({
          error: "qualitative_option_not_active_for_field",
          componentId: component.componentId,
          resultOptionId: entry.resultOptionId,
        }, { status: 409 });
      }
      if (component.resultType === "QUALITATIVE" && fieldOptions.length > 0 && !selectedOption && String(raw || "").trim()) {
        return NextResponse.json({
          error: "qualitative_option_required",
          componentId: component.componentId,
        }, { status: 409 });
      }

      const parsed = parseResultValue(component.resultType, selectedOption ? selectedOption.valueEn : raw);
      if (!parsed) continue;

      const interval = component.componentId ? await resolveReferenceInterval(prisma, {
        componentId: component.componentId,
        branchId: performingBranchId,
        methodId: orderItem.test.methodId,
        patientSex: orderItem.order.patient.sexAtBirth,
        dateOfBirth: orderItem.order.patient.dateOfBirth,
        pregnancyStatus: orderItem.order.pregnancyStatus,
        gestationalAgeWeeks: orderItem.order.gestationalAgeWeeks,
        specimenTypeId: specimen.specimenTypeId,
        populationCode: orderItem.order.referencePopulationCode,
      }) : null;

      const flag = selectedOption
        ? qualitativeFlag({
            flag: selectedOption.flag as "NORMAL" | "ABNORMAL" | "POSITIVE" | "NEGATIVE" | "UNKNOWN",
            isAbnormal: selectedOption.isAbnormal,
            isCritical: selectedOption.isCritical,
          })
        : parsed.valueNumeric !== null
          ? numericFlag(parsed.valueNumeric, interval)
          : { flag: "UNKNOWN" as const, isAbnormal: false, isCritical: false };
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
            ruleId: null,
            lookbackDays: null,
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
        flagSource,
        qualitativeOptionId: selectedOption?.id || null,
        qualitativeOptionCode: selectedOption?.code || null,
        valueTextEnSnapshot: selectedOption?.valueEn || null,
        valueTextArSnapshot: selectedOption?.valueAr || null,
        comments: componentComment,
      });
    }

    const numericInputs: Record<string, Prisma.Decimal> = {};
    for (const item of prepared) {
      if (item.parsed.valueNumeric !== null) numericInputs[item.code.toUpperCase()] = item.parsed.valueNumeric;
    }

    for (const rule of orderItem.test.calculatedRules) {
      const target = expected.find(component => component.componentId === rule.targetComponentId);
      if (!target) continue;

      const variables = formulaVariables(rule.expression);
      if (variables.some(variable => numericInputs[variable] === undefined)) continue;

      const calculationInputs = Object.fromEntries(
        variables.map(variable => [variable, numericInputs[variable].toString()]),
      );
      const precision = rule.decimalPrecision ?? target.decimalPrecision ?? 4;
      const calculated = evaluateFormula(rule.expression, numericInputs).toDecimalPlaces(precision);
      const parsed = {
        valueNumeric: calculated,
        valueText: null,
        valueBoolean: null,
        valueDate: null,
        displayValue: calculated.toFixed(precision),
      };

      const interval = await resolveReferenceInterval(prisma, {
        componentId: rule.targetComponentId,
        branchId: performingBranchId,
        methodId: orderItem.test.methodId,
        patientSex: orderItem.order.patient.sexAtBirth,
        dateOfBirth: orderItem.order.patient.dateOfBirth,
        pregnancyStatus: orderItem.order.pregnancyStatus,
        gestationalAgeWeeks: orderItem.order.gestationalAgeWeeks,
        specimenTypeId: specimen.specimenTypeId,
        populationCode: orderItem.order.referencePopulationCode,
      });
      const flag = numericFlag(calculated, interval);
      const delta = await evaluateDelta(prisma, {
        organizationId: session.user.organizationId,
        patientId: orderItem.order.patientId,
        testId: orderItem.testId,
        componentId: rule.targetComponentId,
        performingBranchId,
        methodId: orderItem.test.methodId,
        currentValue: calculated,
      });

      prepared.push({
        ...target,
        parsed,
        interval,
        flag,
        delta,
        isCalculated: true,
        calculatedRuleId: rule.id,
        calculationExpression: rule.expression,
        calculationInputs,
        flagSource: interval ? "REFERENCE_INTERVAL" : "NONE",
        qualitativeOptionId: null,
        qualitativeOptionCode: null,
        valueTextEnSnapshot: null,
        valueTextArSnapshot: null,
        comments: existingValueByComponent.get(target.componentId || "__TEST__")?.comments || null,
      });
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("INVALID_")) {
      return NextResponse.json({ error: error.message.toLowerCase() }, { status: 400 });
    }
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

  const complete = prepared.length === expected.length;
  const resultStatus = complete ? "ENTERED" : "DRAFT";
  const existingValidationSnapshot = existing?.validationPolicySnapshot
    ? existing.validationPolicySnapshot as unknown as ValidationPolicySnapshot
    : null;
  const validationSnapshot = existingValidationSnapshot || (complete ? configuredValidationSnapshot : null);
  const validationPolicyId = existing?.validationPolicyId
    || (validationSnapshot?.source === "CONFIGURED" ? validationSnapshot.policyId : null);
  const entryValidationStage = complete ? "TECHNICAL_REVIEW" as const : "ENTRY" as const;

  const saved = await prisma.$transaction(async (tx) => {
    if (specimen.status === "RECEIVED") {
      const claimed = await tx.specimen.updateMany({
        where: {
          id: specimen.id,
          status: "RECEIVED",
          currentBranchId: performingBranchId,
          preanalyticalVersion: specimen.preanalyticalVersion,
          orderItems: { some: { orderItemId, status: "ACTIVE" } },
        },
        data: {
          status: "IN_PROCESS",
          preanalyticalVersion: { increment: 1 },
        },
      });
      if (claimed.count !== 1) throw new Error("SPECIMEN_PREANALYTICAL_STATE_CHANGED");
    }

    const result = existing
      ? await tx.laboratoryResult.update({
          where: { id: existing.id },
          data: {
            specimenId,
            performingBranchId,
            methodId: orderItem.test.methodId,
            status: resultStatus,
            source: resultSource,
            enteredByUserId: session.user.id,
            autoVerified: false,
            autoverificationPolicyId: null,
            autoverificationDecisionSnapshot: Prisma.DbNull,
            validationStage: entryValidationStage,
            validationPolicyId,
            validationPolicySnapshot: validationSnapshot ? validationSnapshot as unknown as Prisma.InputJsonValue : Prisma.DbNull,
            technicalReviewedByUserId: null,
            technicalReviewedAt: null,
            medicallyValidatedByUserId: null,
            medicallyValidatedAt: null,
            verifiedByUserId: null,
            verifiedAt: null,
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
            source: resultSource,
            enteredByUserId: session.user.id,
            validationStage: entryValidationStage,
            validationPolicyId,
            validationPolicySnapshot: validationSnapshot ? validationSnapshot as unknown as Prisma.InputJsonValue : undefined,
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
          flagSource: item.flagSource,
          isAbnormal: item.flag.isAbnormal,
          isCritical: item.flag.isCritical,
          qualitativeOptionId: item.qualitativeOptionId,
          qualitativeOptionCodeSnapshot: item.qualitativeOptionCode,
          valueTextEnSnapshot: item.valueTextEnSnapshot,
          valueTextArSnapshot: item.valueTextArSnapshot,
          comments: item.comments,
          deltaEvaluation: item.delta.evaluation,
          previousValueSnapshot: item.delta.previousValue,
          previousResultAtSnapshot: item.delta.previousResultAt,
          deltaAbsoluteSnapshot: item.delta.deltaAbsolute,
          deltaPercentSnapshot: item.delta.deltaPercent,
          deltaAbsoluteLimitSnapshot: item.delta.absoluteLimit,
          deltaPercentLimitSnapshot: item.delta.percentLimit,
          deltaRuleId: item.delta.ruleId,
          deltaLookbackDaysSnapshot: item.delta.lookbackDays,
          isCalculated: item.isCalculated,
          calculatedRuleId: item.calculatedRuleId,
          calculationExpressionSnapshot: item.calculationExpression,
          calculationInputsSnapshot: item.calculationInputs ? item.calculationInputs as Prisma.InputJsonValue : undefined,
        },
      });
    }

    await syncDeltaReviewEvents(tx, {
      resultId: result.id,
      performingBranchId,
      methodId: orderItem.test.methodId,
      detectedAt: resultAt,
    });

    for (const rule of orderItem.test.sourceReflexRules) {
      if (rule.branchId && rule.branchId !== performingBranchId) continue;

      const source = prepared.find(item =>
        rule.sourceComponentId ? item.componentId === rule.sourceComponentId : item.componentId === null
      );
      if (!source) continue;

      const matched = reflexMatches(
        rule.operator,
        {
          numericValue: source.parsed.valueNumeric,
          textValue: source.parsed.valueText,
          displayValue: source.parsed.displayValue,
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
            triggerValueSnapshot: source.parsed.displayValue,
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
            triggerValueSnapshot: source.parsed.displayValue,
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

    for (const rule of orderItem.test.validationHoldRules) {
      const matched = validationHoldMatches(rule, {
        source: resultSource,
        values: prepared.map(item => ({
          flag: item.flag.flag,
          isAbnormal: item.flag.isAbnormal,
          isCritical: item.flag.isCritical,
          deltaEvaluation: item.delta.evaluation,
        })),
      });

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

    const [pendingReflexCount, blockingHoldCount, warningHoldCount] = await Promise.all([
      tx.reflexRuleEvent.count({ where: { resultId: result.id, status: "PENDING" } }),
      tx.validationHoldEvent.count({ where: { resultId: result.id, status: "ACTIVE", severitySnapshot: "BLOCK" } }),
      tx.validationHoldEvent.count({ where: { resultId: result.id, status: "ACTIVE", severitySnapshot: "WARNING" } }),
    ]);

    const autoverificationDecision = evaluateAutoverification({
      policy: autoverificationPolicy,
      source: resultSource,
      complete,
      values: prepared.map(item => ({
        flag: item.flag.flag,
        isAbnormal: item.flag.isAbnormal,
        isCritical: item.flag.isCritical,
        deltaEvaluation: item.delta.evaluation,
      })),
      pendingReflexCount,
      blockingHoldCount,
    });
    const effectiveValidationSnapshot = validationSnapshot || snapshotValidationPolicy(null);
    const autoOutcome = automatedTechnicalReviewOutcome(effectiveValidationSnapshot, {
      eligible: autoverificationDecision.eligible,
      complete,
    });
    const requiresMedicalValidation = effectiveValidationSnapshot.requiresMedicalValidation;
    const finalResultStatus = autoOutcome.resultStatus;
    const finalValidationStage = autoOutcome.validationStage;
    const autoverifiedAt = autoverificationDecision.eligible ? new Date() : null;

    await tx.laboratoryResult.update({
      where: { id: result.id },
      data: {
        status: finalResultStatus,
        validationStage: finalValidationStage,
        validationPolicyId,
        validationPolicySnapshot: validationSnapshot ? validationSnapshot as unknown as Prisma.InputJsonValue : Prisma.DbNull,
        technicalReviewedByUserId: null,
        technicalReviewedAt: autoverifiedAt,
        medicallyValidatedByUserId: null,
        medicallyValidatedAt: null,
        autoVerified: autoverificationDecision.eligible,
        autoverificationPolicyId: autoverificationDecision.policyId,
        autoverificationDecisionSnapshot: autoverificationDecision as Prisma.InputJsonValue,
        verifiedByUserId: null,
        verifiedAt: autoverificationDecision.eligible && !requiresMedicalValidation ? autoverifiedAt : null,
      },
    });

    if (autoverificationDecision.eligible) {
      await tx.resultValidationReview.create({
        data: {
          resultId: result.id,
          stage: "TECHNICAL_REVIEW",
          outcome: "APPROVED",
          reviewerUserId: null,
          automated: true,
          reviewedAt: autoverifiedAt!,
          notes: "Technical review completed by configured autoverification policy",
          policySnapshot: validationSnapshot ? validationSnapshot as unknown as Prisma.InputJsonValue : undefined,
        },
      });
    }

    await tx.orderItem.update({
      where: { id: orderItemId },
      data: {
        performedBranchId: performingBranchId,
        status: finalResultStatus === "VERIFIED" ? "VERIFIED" : "IN_PROGRESS",
      },
    });

    if (specimen.status === "RECEIVED") {
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
          specimenId: existing.specimenId,
          performingBranchId: existing.performingBranchId,
          values: existing.values.map((value) => ({
            componentCode: value.componentCodeSnapshot,
            displayValue: value.displayValue,
            flag: value.flag,
            comments: value.comments,
          })),
        } : undefined,
        newValues: {
          status: finalResultStatus,
          orderItemId,
          specimenId,
          performingBranchId,
          testCode: orderItem.test.code,
          values: prepared.map((item) => ({
            componentCode: item.code,
            displayValue: item.parsed.displayValue,
            flag: item.flag.flag,
            flagSource: item.flagSource,
            abnormal: item.flag.isAbnormal,
            critical: item.flag.isCritical,
            qualitativeOptionId: item.qualitativeOptionId,
            qualitativeOptionCode: item.qualitativeOptionCode,
            comments: item.comments,
            referenceIntervalId: item.interval?.id || null,
            deltaEvaluation: item.delta.evaluation,
            deltaAbsolute: item.delta.deltaAbsolute?.toString() || null,
            deltaPercent: item.delta.deltaPercent?.toString() || null,
            calculated: item.isCalculated,
            calculatedRuleId: item.calculatedRuleId,
          })),
        },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });

    if (finalResultStatus === "VERIFIED") {
      const remaining = await tx.orderItem.count({
        where: {
          orderId: orderItem.orderId,
          status: { notIn: ["VERIFIED", "CANCELLED"] },
        },
      });

      if (remaining === 0) {
        const currentOrder = await tx.labOrder.findUnique({ where: { id: orderItem.orderId }, select: { status: true } });
        if (currentOrder && currentOrder.status !== "COMPLETED") {
          await tx.labOrder.update({ where: { id: orderItem.orderId }, data: { status: "COMPLETED" } });
          await tx.orderStatusHistory.create({
            data: {
              orderId: orderItem.orderId,
              fromStatus: currentOrder.status,
              toStatus: "COMPLETED",
              reason: "All non-cancelled order items verified; final item autoverified",
              changedByUserId: session.user.id,
            },
          });
        }
      }

      await tx.auditEvent.create({
        data: {
          organizationId: session.user.organizationId,
          branchId: performingBranchId,
          actorUserId: session.user.id,
          action: "RESULT_AUTOVERIFIED",
          entityType: "LaboratoryResult",
          entityId: result.id,
          oldValues: { status: resultStatus },
          newValues: {
            status: finalResultStatus,
            validationStage: finalValidationStage,
            policyId: autoverificationDecision.policyId,
            validationPolicyId,
            verifiedAt: autoverificationDecision.eligible && !requiresMedicalValidation ? autoverifiedAt : null,
            technicalReviewedAt: autoverifiedAt,
            medicalValidationRequired: requiresMedicalValidation,
            source: resultSource,
            warningHoldCount,
          },
          reason: "Result met all mandatory autoverification safety gates",
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
        deltaReviewEvents: true,
      },
    });
  }, { timeout: 30000 }).catch(error => {
    if (error instanceof Error && error.message === "SPECIMEN_PREANALYTICAL_STATE_CHANGED") return null;
    throw error;
  });

  if (!saved) {
    return NextResponse.json({ error: "specimen_preanalytical_state_changed" }, { status: 409 });
  }

  return NextResponse.json({
    status: "ok",
    result: saved,
    complete,
    criticalCount: saved?.values.filter((value) => value.isCritical).length || 0,
    deltaExceededCount: saved?.values.filter((value) => value.deltaEvaluation === "EXCEEDED").length || 0,
    pendingDeltaReviewCount: saved?.deltaReviewEvents.filter((event) => event.status === "PENDING").length || 0,
    pendingReflexCount: saved?.reflexEvents.filter((event) => event.status === "PENDING").length || 0,
    blockingValidationHoldCount: saved?.validationHoldEvents.filter((event) => event.status === "ACTIVE" && event.severitySnapshot === "BLOCK").length || 0,
    warningValidationHoldCount: saved?.validationHoldEvents.filter((event) => event.status === "ACTIVE" && event.severitySnapshot === "WARNING").length || 0,
    autoVerified: saved?.autoVerified || false,
    autoverificationDecision: saved?.autoverificationDecisionSnapshot || null,
  }, { status: existing ? 200 : 201 });
}
