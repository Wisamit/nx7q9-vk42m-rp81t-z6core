import { NextResponse } from "next/server";
import { canAccessBranch, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { structuredStorageLocation } from "@/lib/specimen-storage-location";

export async function GET(request: Request) {
  const session = await requirePermission("specimens.view");
  const url = new URL(request.url);
  const branchId = url.searchParams.get("branchId") || session.activeBranchId;
  if (!branchId || !canAccessBranch(session, branchId)) return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });
  const locations = await prisma.specimenStorageLocation.findMany({
    where: { organizationId: session.user.organizationId, branchId, ...(url.searchParams.get("includeInactive") === "true" ? {} : { status: "ACTIVE" }) },
    orderBy: { path: "asc" },
    select: { id: true, path: true, zone: true, unit: true, rack: true, slot: true, status: true },
  });
  return NextResponse.json({ locations });
}

export async function POST(request: Request) {
  const session = await requirePermission("settings.manage");
  const ctx = await requestContext();
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const branchId = typeof body?.branchId === "string" ? body.branchId : session.activeBranchId;
  if (!branchId || !canAccessBranch(session, branchId)) return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });
  const location = structuredStorageLocation(body?.storagePosition);
  if ("error" in location) return NextResponse.json({ error: location.error }, { status: 400 });
  const activeBranch = await prisma.branch.findFirst({ where: { id: branchId, organizationId: session.user.organizationId, status: "ACTIVE" }, select: { id: true } });
  if (!activeBranch) return NextResponse.json({ error: "branch_not_active" }, { status: 409 });
  const existing = await prisma.specimenStorageLocation.findUnique({ where: { branchId_path: { branchId, path: location.path } } });
  if (existing) return NextResponse.json({ error: "storage_location_exists" }, { status: 409 });

  const created = await prisma.$transaction(async tx => {
    const row = await tx.specimenStorageLocation.create({ data: {
      organizationId: session.user.organizationId, branchId, path: location.path, ...location.segments,
    } });
    await tx.auditEvent.create({ data: {
      organizationId: session.user.organizationId, branchId, actorUserId: session.user.id,
      action: "SPECIMEN_STORAGE_LOCATION_CREATED", entityType: "SpecimenStorageLocation", entityId: row.id,
      newValues: { path: row.path, ...location.segments },
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
    } });
    return row;
  });
  return NextResponse.json({ status: "ok", location: created }, { status: 201 });
}

export async function PATCH(request: Request) {
  const session = await requirePermission("settings.manage");
  const ctx = await requestContext();
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const id = typeof body?.id === "string" ? body.id.trim() : "";
  const status = body?.status === "ACTIVE" || body?.status === "INACTIVE" ? body.status : null;
  const reason = typeof body?.reason === "string" ? body.reason.trim().slice(0, 1000) : "";
  if (!id || !status || !reason) return NextResponse.json({ error: "invalid_storage_status_change" }, { status: 400 });
  const location = await prisma.specimenStorageLocation.findFirst({
    where: { id, organizationId: session.user.organizationId },
  });
  if (!location) return NextResponse.json({ error: "storage_location_not_found" }, { status: 404 });
  if (!canAccessBranch(session, location.branchId)) return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });
  if (location.status === status) return NextResponse.json({ error: "storage_location_status_unchanged" }, { status: 409 });

  const changed = await prisma.$transaction(async tx => {
    // Lock the location row before checking for specimens. Relocation checks
    // the same row to prevent a deactivation/assignment race.
    const row = await tx.specimenStorageLocation.updateMany({
      where: { id, organizationId: session.user.organizationId, branchId: location.branchId, status: location.status },
      data: { status },
    });
    if (row.count !== 1) return false;
    if (status === "INACTIVE") {
      const occupied = await tx.specimen.count({
        where: {
          organizationId: session.user.organizationId,
          currentBranchId: location.branchId,
          storageLocation: location.path,
          status: { in: ["COLLECTED", "RECEIVED", "IN_PROCESS", "IN_TRANSIT"] },
        },
      });
      if (occupied) throw new Error("STORAGE_LOCATION_HAS_ACTIVE_SPECIMENS");
    }
    await tx.auditEvent.create({ data: {
      organizationId: session.user.organizationId,
      branchId: location.branchId,
      actorUserId: session.user.id,
      action: "SPECIMEN_STORAGE_LOCATION_STATUS_CHANGED",
      entityType: "SpecimenStorageLocation",
      entityId: id,
      reason,
      oldValues: { status: location.status, path: location.path },
      newValues: { status, path: location.path },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    } });
    return true;
  }).catch(error => {
    if (error instanceof Error && error.message === "STORAGE_LOCATION_HAS_ACTIVE_SPECIMENS") return null;
    throw error;
  });
  if (changed === null) return NextResponse.json({ error: "storage_location_has_active_specimens" }, { status: 409 });
  if (!changed) return NextResponse.json({ error: "storage_location_state_changed" }, { status: 409 });
  return NextResponse.json({ status: "ok", locationId: id, status });
}
