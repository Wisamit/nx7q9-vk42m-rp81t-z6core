import { NextResponse } from "next/server";
import { canAccessBranch, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { structuredStorageLocation } from "@/lib/specimen-storage-location";

export async function GET(request: Request) {
  const session = await requirePermission("specimens.view");
  const branchId = new URL(request.url).searchParams.get("branchId") || session.activeBranchId;
  if (!branchId || !canAccessBranch(session, branchId)) return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });
  const locations = await prisma.specimenStorageLocation.findMany({
    where: { organizationId: session.user.organizationId, branchId, status: "ACTIVE" },
    orderBy: { path: "asc" },
    select: { id: true, path: true, zone: true, unit: true, rack: true, slot: true },
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
