import { NextResponse } from "next/server";
import { getCurrentSession, permissionSet, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { independentAuthorization, retainedDisposalBlock, retentionDueAt } from "@/lib/specimen-retention-safety";

export const dynamic = "force-dynamic";
class Conflict extends Error {}
const idPattern = /^[a-f0-9-]{36}$/i;

async function currentContext() {
  const session = await getCurrentSession();
  if (!session) return null;
  const branchId = session.activeBranchId;
  const organizationId = session.user.organizationId;
  if (!branchId || !session.user.branchScopes.some(s =>
    s.branchId === branchId && s.branch.status === "ACTIVE" && s.branch.organizationId === organizationId
  )) return null;
  return { session, branchId, organizationId, permissions: permissionSet(session) };
}
type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

// Every state transition checks the live tenant/branch scope, then locks the
// specimen before checking release, custody, linked material, and result state.
async function lockAndCheck(tx: Tx, ctx: NonNullable<Awaited<ReturnType<typeof currentContext>>>, specimenId: string) {
  const branch = await tx.branch.findFirst({ where: { id: ctx.branchId,
    organizationId: ctx.organizationId, status: "ACTIVE" }, select: { id: true } });
  const scope = await tx.userBranchScope.findUnique({ where: { userId_branchId: {
    userId: ctx.session.user.id, branchId: ctx.branchId,
  } }, select: { userId: true } });
  if (!branch || !scope) throw new Conflict("branch_scope_changed");
  const locked = await tx.$queryRaw<Array<{id:string}>>`
    SELECT id FROM specimens WHERE id=${specimenId} AND organization_id=${ctx.organizationId}
      AND current_branch_id=${ctx.branchId} FOR UPDATE`;
  if (locked.length !== 1) throw new Conflict("specimen_not_in_current_branch");
  const specimen = await tx.specimen.findFirst({
    where: { id: specimenId, organizationId: ctx.organizationId, currentBranchId: ctx.branchId },
    include: {
      order: { include: { items: { select: { status: true } }, diagnosticReport: {
        include: { versions: { orderBy: { version: "desc" }, take: 1,
          select: { status: true, version: true } } },
      } } },
      childSpecimens: { select: { status: true } },
    },
  });
  if (!specimen) throw new Conflict("specimen_not_found");
  const [activeTransferCount, activeSendOutCount, unreleasedResultCount, activeClinicalHoldCount] = await Promise.all([
    tx.specimenTransferItem.count({ where: { specimenId, status: { in: ["PLANNED", "DISPATCHED", "EXCEPTION"] },
      manifest: { status: { notIn: ["CANCELLED", "RECEIVED"] } } } }),
    tx.sendOutReferral.count({ where: { specimenId, status: { notIn: ["COMPLETED", "CANCELLED"] } } }),
    tx.laboratoryResult.count({ where: { specimenId, status: { notIn: ["RELEASED", "AMENDED", "CANCELLED"] } } }),
    tx.nonconformance.count({ where: { organizationId: ctx.organizationId, sourceEntityType: "Specimen",
      sourceEntityId: specimenId, status: { notIn: ["CLOSED", "CANCELLED"] } } }),
  ]);
  const latest = specimen.order.diagnosticReport?.versions[0];
  const latestReportStatus = latest &&
    latest.version === specimen.order.diagnosticReport?.currentVersion ? latest.status : null;
  const blocked = retainedDisposalBlock({
    status: specimen.status, collectedAt: specimen.collectedAt,
    orderStatus: specimen.order.status, orderItemStatuses: specimen.order.items.map(i => i.status),
    latestReportStatus: latestReportStatus || null,
    activeTransferCount, activeSendOutCount,
    unresolvedChildCount: specimen.childSpecimens.filter(child => child.status !== "DISPOSED").length,
    unreleasedResultCount, activeClinicalHoldCount,
  });
  if (blocked) throw new Conflict(blocked);
  if (!specimen.specimenTypeId || !specimen.collectedAt) throw new Conflict("missing_specimen_type_or_collection");
  return specimen;
}

export async function GET() {
  const ctx = await currentContext();
  if (!ctx || !ctx.permissions.has("specimens.view"))
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const cases = await prisma.specimenDisposalCase.findMany({
    where: { organizationId: ctx.organizationId, branchId: ctx.branchId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 100,
    select: { id: true, specimenId: true, status: true, reason: true, retentionDueAt: true,
      specimenVersion: true, requestedByUserId: true, authorizedByUserId: true,
      createdAt: true, authorizedAt: true, executedAt: true,
      specimen: { select: { barcode: true, status: true } },
      policy: { select: { minimumDays: true, status: true } } },
  });
  return NextResponse.json({ cases });
}

export async function POST(request: Request) {
  const ctx = await currentContext();
  if (!ctx || !ctx.permissions.has("specimens.reject"))
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const raw: unknown = await request.json().catch(() => null);
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  const body = raw as Record<string, unknown>;
  const barcode = typeof body.barcode === "string" ? body.barcode.trim() : "";
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (barcode.length < 3 || barcode.length > 80 || reason.length < 30 || reason.length > 1000)
    return NextResponse.json({ error: "invalid_disposal_request" }, { status: 400 });
  const requestCtx = await requestContext();
  try {
    const row = await prisma.$transaction(async tx => {
      const found = await tx.specimen.findFirst({ where: { organizationId: ctx.organizationId,
        currentBranchId: ctx.branchId, barcode }, select: { id: true } });
      if (!found) throw new Conflict("specimen_not_found_in_branch");
      const specimen = await lockAndCheck(tx, ctx, found.id);
      const pending = await tx.specimenDisposalCase.count({ where: { specimenId: specimen.id,
        status: { in: ["REQUESTED", "AUTHORIZED", "EXECUTED"] } } });
      if (pending) throw new Conflict("existing_disposal_case");
      const policy = await tx.specimenRetentionPolicy.findFirst({ where: {
        organizationId: ctx.organizationId, branchId: ctx.branchId,
        specimenTypeId: specimen.specimenTypeId!, status: "APPROVED",
      }, orderBy: [{ approvedAt: "desc" }, { id: "desc" }] });
      // Policies take prospective effect only. Historical clinical material
      // requires a separately approved migration/legal review, not a backdated date.
      if (!policy?.approvedAt || policy.approvedAt > specimen.collectedAt!)
        throw new Conflict("prospective_approved_retention_policy_required");
      const due = retentionDueAt(specimen.collectedAt!, policy.minimumDays);
      const created = await tx.specimenDisposalCase.create({ data: {
        organizationId: ctx.organizationId, branchId: ctx.branchId,
        specimenId: specimen.id, policyId: policy.id,
        specimenVersion: specimen.preanalyticalVersion, retentionDueAt: due,
        requestedByUserId: ctx.session.user.id, reason,
      } });
      await tx.auditEvent.create({ data: {
        organizationId: ctx.organizationId, branchId: ctx.branchId,
        actorUserId: ctx.session.user.id, action: "SPECIMEN_DISPOSAL_REQUESTED",
        entityType: "SpecimenDisposalCase", entityId: created.id, reason,
        newValues: { specimenId: specimen.id, barcode: specimen.barcode, policyId: policy.id,
          specimenVersion: specimen.preanalyticalVersion, retentionDueAt: due.toISOString(),
          status: "REQUESTED" },
        ipAddress: requestCtx.ipAddress, userAgent: requestCtx.userAgent,
      } });
      return created;
    }, { isolationLevel: "Serializable", timeout: 30000 });
    return NextResponse.json({ status: "ok", id: row.id }, { status: 201 });
  } catch(error) {
    return NextResponse.json({ error: error instanceof Conflict ? error.message : "disposal_request_conflict" },
      { status: 409 });
  }
}

export async function PATCH(request: Request) {
  const ctx = await currentContext();
  if (!ctx) return NextResponse.json({ error: "unauthorized_branch" }, { status: 403 });
  const raw: unknown = await request.json().catch(() => null);
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  const body = raw as Record<string, unknown>;
  const id = typeof body.id === "string" ? body.id : "";
  const action = body.action;
  const evidence = typeof body.evidence === "string" ? body.evidence.trim() : "";
  if (!idPattern.test(id) || !["AUTHORIZE", "EXECUTE", "CANCEL"].includes(String(action)) ||
      evidence.length < 30 || evidence.length > 1000)
    return NextResponse.json({ error: "invalid_disposal_transition" }, { status: 400 });
  if (action === "AUTHORIZE" && !ctx.permissions.has("quality.nonconformance.manage") ||
      action === "EXECUTE" && !ctx.permissions.has("specimens.reject") ||
      action === "CANCEL" && !ctx.permissions.has("specimens.reject") &&
        !ctx.permissions.has("quality.nonconformance.manage"))
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const requestCtx = await requestContext();
  try {
    await prisma.$transaction(async tx => {
      const row = await tx.specimenDisposalCase.findFirst({ where: {
        id, organizationId: ctx.organizationId, branchId: ctx.branchId },
        select: { specimenId: true } });
      if (!row) throw new Conflict("case_not_found");
      const specimen = await lockAndCheck(tx, ctx, row.specimenId);
      const rowLocked = await tx.specimenDisposalCase.findUniqueOrThrow({
        where: { id }, include: { policy: true } });
      if (specimen.preanalyticalVersion !== rowLocked.specimenVersion)
        throw new Conflict("specimen_changed_since_request");
      if (rowLocked.policy.status !== "APPROVED" ||
          rowLocked.policy.branchId !== ctx.branchId ||
          rowLocked.policy.specimenTypeId !== specimen.specimenTypeId)
        throw new Conflict("policy_no_longer_current");
      if (rowLocked.policy.approvedAt === null || rowLocked.policy.approvedAt > specimen.collectedAt!)
        throw new Conflict("policy_not_valid_for_collection");
      if (rowLocked.retentionDueAt.getTime() > Date.now())
        throw new Conflict("retention_period_not_elapsed");
      if (action === "AUTHORIZE") {
        if (rowLocked.status !== "REQUESTED" ||
            !independentAuthorization(rowLocked.requestedByUserId, ctx.session.user.id))
          throw new Conflict("independent_authorization_required");
        const updated = await tx.specimenDisposalCase.updateMany({ where: { id, status: "REQUESTED" },
          data: { status: "AUTHORIZED", authorizedAt: new Date(), authorizedByUserId: ctx.session.user.id } });
        if (updated.count !== 1) throw new Conflict("case_changed");
      } else if (action === "EXECUTE") {
        if (rowLocked.status !== "AUTHORIZED" || !rowLocked.authorizedByUserId ||
            !independentAuthorization(rowLocked.requestedByUserId,
              rowLocked.authorizedByUserId, ctx.session.user.id))
          throw new Conflict("independent_execution_required");
        const updated = await tx.specimen.updateMany({ where: {
          id: specimen.id, organizationId: ctx.organizationId, currentBranchId: ctx.branchId,
          status: specimen.status, preanalyticalVersion: rowLocked.specimenVersion,
        }, data: { status: "DISPOSED", storageLocation: null, storageLocationId: null,
          preanalyticalVersion: { increment: 1 } } });
        if (updated.count !== 1) throw new Conflict("specimen_changed");
        await tx.specimenDisposalCase.update({ where: { id }, data: {
          status: "EXECUTED", executedAt: new Date(), executedByUserId: ctx.session.user.id,
        } });
        await tx.specimenEvent.create({ data: {
          specimenId: specimen.id, eventType: "DISPOSED", branchId: ctx.branchId,
          actorUserId: ctx.session.user.id, fromStatus: specimen.status, toStatus: "DISPOSED",
          details: { caseId: id, policyId: rowLocked.policyId,
            previousStorageLocation: specimen.storageLocation,
            previousStorageLocationId: specimen.storageLocationId,
            retentionDueAt: rowLocked.retentionDueAt.toISOString(), executionEvidence: evidence },
        } });
      } else {
        if (rowLocked.status !== "REQUESTED" && rowLocked.status !== "AUTHORIZED")
          throw new Conflict("case_not_cancellable");
        await tx.specimenDisposalCase.update({ where: { id }, data: { status: "CANCELLED" } });
      }
      await tx.auditEvent.create({ data: {
        organizationId: ctx.organizationId, branchId: ctx.branchId, actorUserId: ctx.session.user.id,
        action: action === "AUTHORIZE" ? "SPECIMEN_DISPOSAL_AUTHORIZED" :
          action === "EXECUTE" ? "SPECIMEN_RETAINED_MATERIAL_DISPOSED" : "SPECIMEN_DISPOSAL_CANCELLED",
        entityType: "SpecimenDisposalCase", entityId: id, reason: evidence,
        oldValues: { status: rowLocked.status, specimenStatus: specimen.status,
          storageLocationId: specimen.storageLocationId },
        newValues: { status: action === "AUTHORIZE" ? "AUTHORIZED" :
          action === "EXECUTE" ? "EXECUTED" : "CANCELLED",
          specimenId: specimen.id, policyId: rowLocked.policyId,
          specimenStatus: action === "EXECUTE" ? "DISPOSED" : specimen.status,
          retentionDueAt: rowLocked.retentionDueAt.toISOString() },
        ipAddress: requestCtx.ipAddress, userAgent: requestCtx.userAgent,
      } });
    }, { isolationLevel: "Serializable", timeout: 30000 });
    return NextResponse.json({ status: "ok" });
  } catch(error) {
    return NextResponse.json({ error: error instanceof Conflict ? error.message : "disposal_state_conflict" },
      { status: 409 });
  }
}
