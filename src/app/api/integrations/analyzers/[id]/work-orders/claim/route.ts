import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authenticateAnalyzerBridge } from "@/lib/analyzer-auth";
import { analyzerWorkOrderClinicalEligibility } from "@/lib/analyzer-work-orders";

const LEASE_MS = 120_000;

/**
 * Analyzer Bridge claims protocol-neutral orders. The Bridge, not the LIS,
 * translates these immutable codes into device-specific ASTM or HL7 messages.
 * Never expose this endpoint to a browser/session role.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const credential = await authenticateAnalyzerBridge(request, id);
  if (!credential) {
    return NextResponse.json({ error: "analyzer_bridge_unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const candidates = await prisma.analyzerWorkOrder.findMany({
    where: {
      organizationId: credential.analyzer.organizationId,
      analyzerId: credential.analyzer.id,
      branchId: credential.analyzer.branchId,
      OR: [
        { status: "QUEUED" },
        { status: "RETRY_WAIT", nextAttemptAt: { lte: now } },
        { status: "CLAIMED", leaseExpiresAt: { lte: now } },
      ],
    },
    orderBy: { createdAt: "asc" },
    take: 20,
  });

  const commands: Array<{
    workOrderId: string;
    leaseToken: string;
    attempt: number;
    bridgeDeviceKey: string;
    accessionNumber: string;
    specimenBarcode: string;
    lisTestCode: string;
    analyzerTestCode: string;
  }> = [];

  for (const candidate of candidates) {
    const leaseToken = randomBytes(32).toString("hex");
    const claimTokenHash = createHash("sha256").update(leaseToken).digest("hex");

    const command = await prisma.$transaction(async tx => {
      // A transfer/quarantine must not race a device command claim.
      const specimens = await tx.$queryRaw<Array<{
        id: string; status: string; current_branch_id: string | null;
      }>>`
        SELECT id, status, current_branch_id FROM specimens
        WHERE id = ${candidate.specimenId} AND organization_id = ${credential.analyzer.organizationId}
        FOR UPDATE
      `;
      // Paused equipment must not dispatch physical analyzer commands.
      // Do not CANCEL the queued job: a later qualified restoration may retry it.
      const equipmentRows = await tx.$queryRaw<Array<{ id: string; status: string }>>`
        SELECT id, status FROM equipment
        WHERE analyzer_id = ${credential.analyzer.id}
        AND organization_id = ${credential.analyzer.organizationId}
        AND branch_id = ${credential.analyzer.branchId}
        FOR UPDATE
      `;
      if (equipmentRows.length !== 1 || equipmentRows[0].status !== "ACTIVE") return null;
      const openDowntime = await tx.equipmentDowntime.count({
        where: { equipmentId: equipmentRows[0].id, status: "OPEN" },
      });
      if (openDowntime > 0) return null;

      const workItem = await tx.orderItem.findFirst({
        where: {
          id: candidate.orderItemId,
          order: { organizationId: credential.analyzer.organizationId },
        },
        select: {
          status: true,
          results: {
            orderBy: { version: "desc" },
            take: 1,
            select: { status: true, validationStage: true },
          },
        },
      });
      const activeRoute = await tx.orderItemAnalyzerRoute.findUnique({
        where: {
          orderItemId_analyzerId: {
            orderItemId: candidate.orderItemId,
            analyzerId: credential.analyzer.id,
          },
        },
        select: { analyzerBranchIdSnapshot: true },
      });
      const activeLink = await tx.specimenOrderItem.count({
        where: {
          orderItemId: candidate.orderItemId,
          specimenId: candidate.specimenId,
          status: "ACTIVE",
        },
      });
      const analyzer = await tx.analyzer.findFirst({
        where: {
          id: credential.analyzer.id,
          organizationId: credential.analyzer.organizationId,
          branchId: credential.analyzer.branchId,
          status: "ACTIVE",
        },
        select: { bridgeDeviceKey: true },
      });
      const mapping = await tx.analyzerTestMapping.count({
        where: {
          analyzerId: credential.analyzer.id,
          analyzerTestCode: candidate.analyzerTestCodeSnapshot,
          status: "ACTIVE",
          approvalStatus: "APPROVED",
          effectiveFrom: { lte: now },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }],
          test: {
            orderItems: { some: { id: candidate.orderItemId } },
          },
        },
      });
      const clinical = workItem && specimens.length === 1
        ? analyzerWorkOrderClinicalEligibility({
          specimenStatus: specimens[0].status,
          currentBranchId: specimens[0].current_branch_id,
          analyzerBranchId: credential.analyzer.branchId,
          orderItemStatus: workItem.status,
          resultStatuses: workItem.results.map(result => result.status),
          validationStages: workItem.results.map(result => result.validationStage),
        })
        : "SPECIMEN_UNREADY";
      const eligible = clinical === "READY"
        && activeLink === 1
        && activeRoute?.analyzerBranchIdSnapshot === credential.analyzer.branchId
        && analyzer?.bridgeDeviceKey === candidate.bridgeDeviceKeySnapshot
        && mapping > 0;

      if (!eligible || candidate.attemptCount >= candidate.maxAttempts) {
        const changed = await tx.analyzerWorkOrder.updateMany({
          where: {
            id: candidate.id,
            status: candidate.status,
            updatedAt: candidate.updatedAt,
          },
          data: {
            status: eligible ? "DEAD_LETTER" : "CANCELLED",
            lastError: eligible ? "max_claim_attempts_exhausted" : "analyzer_order_no_longer_eligible",
            leaseExpiresAt: null,
            claimTokenHash: null,
            nextAttemptAt: null,
          },
        });
        if (changed.count === 1) {
          await tx.auditEvent.create({
            data: {
              organizationId: credential.analyzer.organizationId,
              branchId: credential.analyzer.branchId,
              action: eligible ? "ANALYZER_WORK_ORDER_DEAD_LETTER" : "ANALYZER_WORK_ORDER_CANCELLED",
              entityType: "AnalyzerWorkOrder",
              entityId: candidate.id,
              newValues: { workOrderStatus: eligible ? "DEAD_LETTER" : "CANCELLED", clinical },
              reason: "Automated analyzer dispatch eligibility check",
            },
          });
        }
        return null;
      }

      const expires = new Date(now.getTime() + LEASE_MS);
      const claimed = await tx.analyzerWorkOrder.updateMany({
        where: {
          id: candidate.id,
          organizationId: credential.analyzer.organizationId,
          analyzerId: credential.analyzer.id,
          status: candidate.status,
          attemptCount: candidate.attemptCount,
          updatedAt: candidate.updatedAt,
        },
        data: {
          status: "CLAIMED",
          attemptCount: { increment: 1 },
          claimTokenHash,
          claimedAt: now,
          leaseExpiresAt: expires,
          nextAttemptAt: null,
          lastError: null,
        },
      });
      if (claimed.count !== 1) return null;

      await tx.auditEvent.create({
        data: {
          organizationId: credential.analyzer.organizationId,
          branchId: credential.analyzer.branchId,
          action: "ANALYZER_WORK_ORDER_CLAIMED",
          entityType: "AnalyzerWorkOrder",
          entityId: candidate.id,
          newValues: { analyzerId: credential.analyzer.id, attempt: candidate.attemptCount + 1, leaseExpiresAt: expires.toISOString() },
          reason: "Authenticated Analyzer Bridge claim",
        },
      });
      return {
        workOrderId: candidate.id,
        leaseToken,
        attempt: candidate.attemptCount + 1,
        bridgeDeviceKey: candidate.bridgeDeviceKeySnapshot,
        accessionNumber: candidate.accessionNumberSnapshot,
        specimenBarcode: candidate.barcodeSnapshot,
        lisTestCode: candidate.testCodeSnapshot,
        analyzerTestCode: candidate.analyzerTestCodeSnapshot,
      };
    }, { timeout: 30000 });

    if (command) commands.push(command);
  }

  return NextResponse.json({
    status: "ok",
    deliveryGuarantee: "AT_LEAST_ONCE",
    bridgeMustDeduplicateBy: "workOrderId",
    workOrders: commands,
  });
}
