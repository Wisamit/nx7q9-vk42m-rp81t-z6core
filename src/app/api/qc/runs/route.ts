import { NextResponse } from "next/server";
import { Prisma } from "../../../../../generated/prisma/client";
import { canAccessBranch, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { evaluateWestgard, normalizeWestgardRules } from "@/lib/qc-westgard";
import {lockLotsForSafety,assertLotUsable} from "@/lib/inventory-lot-safety";

function text(value: unknown, max = 5000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
function decimal(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(raw)) throw new Error("INVALID_DECIMAL");
  return new Prisma.Decimal(raw);
}

export async function POST(request: Request) {
  const session = await requirePermission("qc.enter");
  const ctx = await requestContext();
  const body = await request.json().catch(() => null) as {
    analyzerId?: unknown;
    runAt?: unknown;
    notes?: unknown;
    results?: Array<{ targetId?: unknown; observedValue?: unknown }>;
  } | null;

  if (!body || !Array.isArray(body.results) || body.results.length === 0 || body.results.length > 200) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const analyzerId = text(body.analyzerId, 36);
  const runAt = body.runAt ? new Date(String(body.runAt)) : new Date();
  if (!analyzerId || Number.isNaN(runAt.getTime())) {
    return NextResponse.json({ error: "missing_or_invalid_fields" }, { status: 400 });
  }

  const targetIds = body.results.map(item => text(item.targetId, 36));
  if (targetIds.some(id => !id) || new Set(targetIds).size !== targetIds.length) {
    return NextResponse.json({ error: "duplicate_or_missing_qc_targets" }, { status: 400 });
  }

  let observations: Array<{ targetId: string; observedValue: Prisma.Decimal }>;
  try {
    observations = body.results.map(item => ({
      targetId: text(item.targetId, 36),
      observedValue: decimal(item.observedValue),
    }));
  } catch {
    return NextResponse.json({ error: "invalid_qc_observed_value" }, { status: 400 });
  }

  const [analyzer, targets] = await Promise.all([
    prisma.analyzer.findFirst({
      where: { id: analyzerId, organizationId: session.user.organizationId, status: "ACTIVE" },
      include: { equipment: true },
    }),
    prisma.qcTarget.findMany({
      where: {
        id: { in: targetIds },
        organizationId: session.user.organizationId,
        analyzerId,
        status: "ACTIVE",
        effectiveFrom: { lte: runAt },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: runAt } }],
      },
      include: { test: true, component: true, qcLot: true },
    }),
  ]);

  if (!analyzer) return NextResponse.json({ error: "analyzer_not_found" }, { status: 404 });
  if (!canAccessBranch(session, analyzer.branchId)) return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });
  if (!analyzer.equipment) return NextResponse.json({ error: "analyzer_equipment_registration_required" }, { status: 409 });
  if (targets.length !== targetIds.length) return NextResponse.json({ error: "qc_target_not_found_or_inactive" }, { status: 404 });
  const invalidLot = targets.find(target =>
    target.qcLot.status !== "ACTIVE" || (target.qcLot.expiryDate && target.qcLot.expiryDate < runAt)
  );
  if (invalidLot) {
    return NextResponse.json({
      error: invalidLot.qcLot.status !== "ACTIVE" ? "qc_lot_not_active" : "qc_lot_expired",
      qcLotId: invalidLot.qcLotId,
      targetId: invalidLot.id,
    }, { status: 409 });
  }

  try {
    const saved = await prisma.$transaction(async tx => {
      // One analyzer's QC sequence must be evaluated in a single committed order.
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM analyzers WHERE id = ${analyzerId}
        AND organization_id = ${session.user.organizationId}
        AND branch_id = ${analyzer.branchId} AND status = 'ACTIVE' FOR UPDATE
      `;
      if (locked.length !== 1) throw new Error("ANALYZER_NOT_ACTIVE");

      const currentAnalyzer = await tx.analyzer.findFirst({
        where: { id: analyzerId, organizationId: session.user.organizationId, status: "ACTIVE" },
        include: { equipment: true },
      });
      if (!currentAnalyzer?.equipment || currentAnalyzer.equipment.branchId !== currentAnalyzer.branchId) {
        throw new Error("ANALYZER_EQUIPMENT_MISMATCH");
      }
      const linkedInventoryLotIds=targets
        .map(t=>t.qcLot.inventoryLotId).filter((x):x is string=>!!x);
      const inventorySafety=await lockLotsForSafety(tx,session.user.organizationId,linkedInventoryLotIds);
      for(const linkedId of linkedInventoryLotIds)assertLotUsable(inventorySafety,linkedId);
      const currentTargets = await tx.qcTarget.findMany({
        where: {
          id: { in: targetIds },
          organizationId: session.user.organizationId,
          analyzerId,
          status: "ACTIVE",
          effectiveFrom: { lte: runAt },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: runAt } }],
        },
        include: { qcLot: true },
      });
      if (currentTargets.length !== observations.length || currentTargets.some(target =>
        target.qcLot.status !== "ACTIVE" ||
        (target.qcLot.expiryDate && target.qcLot.expiryDate < runAt)
      )) throw new Error("QC_TARGET_OR_LOT_CHANGED");
      const currentTargetById = new Map(currentTargets.map(target => [target.id, target]));

      const run = await tx.qcRun.create({
        data: {
          organizationId: session.user.organizationId,
          branchId: analyzer.branchId,
          analyzerId,
          runAt,
          operatorUserId: session.user.id,
          notes: text(body.notes) || null,
        },
      });

      const evaluated: Array<{
        targetId: string;
        status: "PASS" | "WARN" | "FAIL";
        zScore: Prisma.Decimal;
        violations: ReturnType<typeof evaluateWestgard>;
      }> = [];

      const computed = observations.map(observation => {
        const target = currentTargetById.get(observation.targetId)!;
        const zScore = observation.observedValue.sub(target.targetMean).div(target.targetSd);
        return { observation, target, zScore };
      });

      for (const item of computed) {
        const history = await tx.qcResult.findMany({
          where: {
            targetId: item.target.id,
            run: { runAt: { lte: runAt }, status: { not: "CANCELLED" } },
          },
          include: { run: { select: { runAt: true } } },
          orderBy: [{ run: { runAt: "desc" } }, { createdAt: "desc" }],
          take: 9,
        });

        const siblingZ = computed
          .filter(other =>
            other.target.id !== item.target.id &&
            other.target.testId === item.target.testId &&
            other.target.componentId === item.target.componentId
          )
          .map(other => other.zScore.toNumber());

        const enabledRules = normalizeWestgardRules(item.target.enabledRules);
        const violations = evaluateWestgard({
          currentZ: item.zScore.toNumber(),
          previousZ: history.map(result => result.zScore.toNumber()),
          siblingZ,
          enabledRules,
        });
        const status: "PASS" | "WARN" | "FAIL" = violations.some(v => v.severity === "BLOCK")
          ? "FAIL"
          : violations.length > 0 ? "WARN" : "PASS";

        await tx.qcResult.create({
          data: {
            qcRunId: run.id,
            targetId: item.target.id,
            observedValue: item.observation.observedValue,
            targetMeanSnapshot: item.target.targetMean,
            targetSdSnapshot: item.target.targetSd,
            targetCvSnapshot: item.target.targetCv,
            zScore: item.zScore.toDecimalPlaces(6),
            status,
            evaluatedRules: {
              enabledRules,
              violations,
            } as Prisma.InputJsonValue,
          },
        });

        for (const violation of violations) {
          await tx.qcRuleViolation.create({
            data: {
              qcRunId: run.id,
              targetId: item.target.id,
              ruleCode: violation.ruleCode,
              severity: violation.severity,
              details: violation.details as Prisma.InputJsonValue,
            },
          });
        }

        evaluated.push({
          targetId: item.target.id,
          status,
          zScore: item.zScore.toDecimalPlaces(6),
          violations,
        });
      }

      const runStatus = evaluated.some(item => item.status === "FAIL")
        ? "FAIL"
        : evaluated.some(item => item.status === "WARN") ? "WARN" : "PASS";

      const updatedRun = await tx.qcRun.update({
        where: { id: run.id },
        data: { status: runStatus },
        include: {
          results: { include: { target: { include: { test: true, component: true } } } },
          violations: true,
        },
      });

      await tx.auditEvent.create({
        data: {
          organizationId: session.user.organizationId,
          branchId: analyzer.branchId,
          actorUserId: session.user.id,
          action: "QC_RUN_EVALUATED",
          entityType: "QcRun",
          entityId: run.id,
          newValues: {
            analyzerId,
            equipmentId: analyzer.equipment?.id || null,
            qcLotIds: [...new Set(currentTargets.map(target => target.qcLotId))],
            runAt,
            status: runStatus,
            results: evaluated.map(item => ({
              targetId: item.targetId,
              status: item.status,
              zScore: item.zScore.toString(),
              violations: item.violations.map(v => ({ ruleCode: v.ruleCode, severity: v.severity })),
            })),
          },
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
      });

      return updatedRun;
    }, { isolationLevel: "Serializable", timeout: 30000 });

    return NextResponse.json({
      status: "ok",
      qcRun: saved,
      blockingViolationCount: saved.violations.filter(v => v.severity === "BLOCK" && v.status === "OPEN").length,
      warningViolationCount: saved.violations.filter(v => v.severity === "WARNING" && v.status === "OPEN").length,
    }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "qc_run_evaluation_failed" }, { status: 409 });
  }
}
