import { NextResponse } from "next/server";
import { getCurrentSession, permissionSet, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";
class Conflict extends Error {}
const idPattern = /^[a-f0-9-]{36}$/i;

async function context() {
  const session = await getCurrentSession();
  if (!session) return null;
  const branchId = session.activeBranchId;
  if (!branchId || !session.user.branchScopes.some(s =>
    s.branchId === branchId && s.branch.status === "ACTIVE" &&
    s.branch.organizationId === session.user.organizationId
  )) return null;
  return { session, branchId, organizationId: session.user.organizationId, permissions: permissionSet(session) };
}

export async function GET() {
  const ctx = await context();
  if (!ctx) return NextResponse.json({ error: "unauthorized_branch" }, { status: 403 });
  if (!ctx.permissions.has("specimens.view") && !ctx.permissions.has("settings.manage") &&
      !ctx.permissions.has("quality.nonconformance.manage"))
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const policies = await prisma.specimenRetentionPolicy.findMany({
    where: { organizationId: ctx.organizationId, branchId: ctx.branchId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 100,
    select: { id: true, specimenTypeId: true, minimumDays: true, rationale: true,
      status: true, createdAt: true, approvedAt: true, createdByUserId: true },
  });
  return NextResponse.json({ policies });
}

export async function POST(request: Request) {
  const ctx = await context();
  if (!ctx || !ctx.permissions.has("settings.manage"))
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const raw: unknown = await request.json().catch(() => null);
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  const body = raw as Record<string, unknown>;
  const specimenTypeId = typeof body.specimenTypeId === "string" ? body.specimenTypeId : "";
  const days = body.minimumDays;
  const rationale = typeof body.rationale === "string" ? body.rationale.trim() : "";
  if (!idPattern.test(specimenTypeId) || typeof days !== "number" || !Number.isInteger(days) ||
      days < 1 || days > 73000 || rationale.length < 30 || rationale.length > 1000)
    return NextResponse.json({ error: "invalid_retention_policy" }, { status: 400 });
  const requestCtx = await requestContext();
  try {
    const policy = await prisma.$transaction(async tx => {
      const branch = await tx.branch.findFirst({ where: { id: ctx.branchId,
        organizationId: ctx.organizationId, status: "ACTIVE" }, select: { id: true } });
      const scope = await tx.userBranchScope.findUnique({
        where: { userId_branchId: { userId: ctx.session.user.id, branchId: ctx.branchId } } });
      const type = await tx.specimenType.findFirst({ where: { id: specimenTypeId,
        organizationId: ctx.organizationId, status: "ACTIVE" } });
      if (!branch || !scope || !type) throw new Conflict("scope_or_type_changed");
      const created = await tx.specimenRetentionPolicy.create({ data: {
        organizationId: ctx.organizationId, branchId: ctx.branchId, specimenTypeId,
        minimumDays: days, rationale, createdByUserId: ctx.session.user.id,
      } });
      await tx.auditEvent.create({ data: {
        organizationId: ctx.organizationId, branchId: ctx.branchId,
        actorUserId: ctx.session.user.id, action: "SPECIMEN_RETENTION_POLICY_DRAFTED",
        entityType: "SpecimenRetentionPolicy", entityId: created.id,
        newValues: { specimenTypeId, minimumDays: days, rationale, status: "DRAFT" },
        ipAddress: requestCtx.ipAddress, userAgent: requestCtx.userAgent,
      } });
      return created;
    }, { isolationLevel: "Serializable" });
    return NextResponse.json({ status: "ok", id: policy.id }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "retention_policy_conflict" }, { status: 409 });
  }
}

export async function PATCH(request: Request) {
  const ctx = await context();
  if (!ctx || !ctx.permissions.has("quality.nonconformance.manage"))
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const raw: unknown = await request.json().catch(() => null);
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  const body = raw as Record<string, unknown>;
  const id = typeof body.id === "string" ? body.id : "";
  const action = body.action;
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (!idPattern.test(id) || (action !== "APPROVE" && action !== "RETIRE") ||
      reason.length < 20 || reason.length > 1000)
    return NextResponse.json({ error: "invalid_policy_review" }, { status: 400 });
  const requestCtx = await requestContext();
  try {
    await prisma.$transaction(async tx => {
      const locked = await tx.$queryRaw<Array<{id:string}>>`
        SELECT id FROM branches WHERE id=${ctx.branchId} AND organization_id=${ctx.organizationId}
          AND status='ACTIVE' FOR UPDATE`;
      const scope = await tx.userBranchScope.findUnique({
        where: { userId_branchId: { userId: ctx.session.user.id, branchId: ctx.branchId } } });
      if (!locked.length || !scope) throw new Conflict("branch_scope_changed");
      const policy = await tx.specimenRetentionPolicy.findFirst({
        where: { id, organizationId: ctx.organizationId, branchId: ctx.branchId } });
      if (!policy) throw new Conflict("policy_not_found");
      if (action === "APPROVE") {
        if (policy.status !== "DRAFT" || policy.createdByUserId === ctx.session.user.id)
          throw new Conflict("independent_draft_review_required");
        const now = new Date();
        const superseded = await tx.specimenRetentionPolicy.findMany({
          where: { organizationId: ctx.organizationId, branchId: ctx.branchId,
            specimenTypeId: policy.specimenTypeId, status: "APPROVED" },
          select: { id: true, minimumDays: true },
        });
        await tx.specimenRetentionPolicy.updateMany({
          where: { organizationId: ctx.organizationId, branchId: ctx.branchId,
            specimenTypeId: policy.specimenTypeId, status: "APPROVED" },
          data: { status: "RETIRED", retiredAt: now, retiredByUserId: ctx.session.user.id } });
        for (const previous of superseded) {
          await tx.auditEvent.create({ data: {
            organizationId: ctx.organizationId, branchId: ctx.branchId,
            actorUserId: ctx.session.user.id, action: "SPECIMEN_RETENTION_POLICY_SUPERSEDED",
            entityType: "SpecimenRetentionPolicy", entityId: previous.id, reason,
            oldValues: { status: "APPROVED", minimumDays: previous.minimumDays },
            newValues: { status: "RETIRED", supersededByPolicyId: policy.id },
            ipAddress: requestCtx.ipAddress, userAgent: requestCtx.userAgent,
          } });
        }
        const changed = await tx.specimenRetentionPolicy.updateMany({
          where: { id, status: "DRAFT" },
          data: { status: "APPROVED", approvedByUserId: ctx.session.user.id, approvedAt: now },
        });
        if (changed.count !== 1) throw new Conflict("policy_state_changed");
      } else {
        if (policy.status !== "APPROVED") throw new Conflict("policy_not_active");
        const changed = await tx.specimenRetentionPolicy.updateMany({
          where: { id, status: "APPROVED" },
          data: { status: "RETIRED", retiredAt: new Date(), retiredByUserId: ctx.session.user.id } });
        if (changed.count !== 1) throw new Conflict("policy_state_changed");
      }
      await tx.auditEvent.create({ data: {
        organizationId: ctx.organizationId, branchId: ctx.branchId,
        actorUserId: ctx.session.user.id, action: action === "APPROVE"
          ? "SPECIMEN_RETENTION_POLICY_APPROVED" : "SPECIMEN_RETENTION_POLICY_RETIRED",
        entityType: "SpecimenRetentionPolicy", entityId: id, reason,
        oldValues: { status: policy.status }, newValues: { status: action === "APPROVE" ? "APPROVED" : "RETIRED",
          specimenTypeId: policy.specimenTypeId, minimumDays: policy.minimumDays },
        ipAddress: requestCtx.ipAddress, userAgent: requestCtx.userAgent,
      } });
    }, { isolationLevel: "Serializable", timeout: 30000 });
    return NextResponse.json({ status: "ok" });
  } catch(error) {
    return NextResponse.json({ error: error instanceof Conflict ? error.message : "policy_state_conflict" },
      { status: 409 });
  }
}
