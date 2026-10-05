import { NextResponse } from "next/server";
import { canAccessBranch, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";

const usageTypes = new Set(["TESTING", "SEND_OUT", "RETENTION", "TRANSFER", "OTHER"]);
function text(value: unknown, max = 500) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("specimens.use");
  const { id } = await params;
  const body = await request.json().catch(() => null) as {
    usageType?: unknown; volumeUsed?: unknown; volumeUnit?: unknown; purpose?: unknown; orderItemId?: unknown;
  } | null;

  const specimen = await prisma.specimen.findFirst({
    where: { id, organizationId: session.user.organizationId },
    include: { orderItems: true, usageEvents: { select: { volumeUsed: true, volumeUnit: true } } },
  });
  if (!specimen) return NextResponse.json({ error: "specimen_not_found" }, { status: 404 });
  if (!specimen.currentBranchId || !canAccessBranch(session, specimen.currentBranchId)) {
    return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });
  }
  if (!["RECEIVED", "IN_PROCESS"].includes(specimen.status)) {
    return NextResponse.json({ error: "specimen_not_available_for_use", status: specimen.status }, { status: 409 });
  }

  const usageType = typeof body?.usageType === "string" && usageTypes.has(body.usageType) ? body.usageType : null;
  if (!usageType) return NextResponse.json({ error: "invalid_usage_type" }, { status: 400 });

  const rawVolume = body?.volumeUsed == null || body.volumeUsed === "" ? null : Number(body.volumeUsed);
  if (rawVolume !== null && (!Number.isFinite(rawVolume) || rawVolume <= 0)) {
    return NextResponse.json({ error: "invalid_volume_used" }, { status: 400 });
  }
  const requestedUnit = text(body?.volumeUnit, 30);
  const volumeUnit = rawVolume === null ? null : specimen.volumeUnit || requestedUnit;
  if (rawVolume !== null && !volumeUnit) return NextResponse.json({ error: "volume_unit_required" }, { status: 400 });
  if (rawVolume !== null && specimen.volumeUnit && requestedUnit && requestedUnit !== specimen.volumeUnit) {
    return NextResponse.json({ error: "volume_unit_mismatch", expected: specimen.volumeUnit }, { status: 400 });
  }
  if (rawVolume !== null && specimen.volume !== null && volumeUnit === specimen.volumeUnit) {
    const used = specimen.usageEvents.reduce((sum, event) => {
      if (!event.volumeUsed || event.volumeUnit !== volumeUnit) return sum;
      return sum + event.volumeUsed.toNumber();
    }, 0);
    const remaining = Math.max(0, specimen.volume.toNumber() - used);
    if (rawVolume > remaining + 0.0005) {
      return NextResponse.json({ error: "insufficient_remaining_volume", remaining, volumeUnit }, { status: 409 });
    }
  }

  const orderItemId = text(body?.orderItemId, 36) || null;
  if (orderItemId && !specimen.orderItems.some(link => link.orderItemId === orderItemId)) {
    return NextResponse.json({ error: "order_item_not_linked_to_specimen" }, { status: 400 });
  }
  const purpose = text(body?.purpose, 500) || null;
  const ctx = await requestContext();

  const event = await prisma.$transaction(async tx => {
    const usage = await tx.specimenUsageEvent.create({
      data: {
        organizationId: specimen.organizationId,
        specimenId: specimen.id,
        branchId: specimen.currentBranchId!,
        orderItemId,
        usedByUserId: session.user.id,
        usageType: usageType as "TESTING" | "SEND_OUT" | "RETENTION" | "TRANSFER" | "OTHER",
        volumeUsed: rawVolume === null ? null : rawVolume.toFixed(3),
        volumeUnit,
        purpose,
      },
    });
    await tx.specimenEvent.create({
      data: {
        specimenId: specimen.id,
        eventType: "USAGE_RECORDED",
        branchId: specimen.currentBranchId,
        actorUserId: session.user.id,
        fromStatus: specimen.status,
        toStatus: specimen.status,
        details: { usageType, volumeUsed: rawVolume === null ? null : rawVolume.toFixed(3), volumeUnit, orderItemId, purpose },
      },
    });
    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: specimen.currentBranchId,
        actorUserId: session.user.id,
        action: "SPECIMEN_USAGE_RECORDED",
        entityType: "Specimen",
        entityId: specimen.id,
        newValues: { usageType, volumeUsed: rawVolume === null ? null : rawVolume.toFixed(3), volumeUnit, orderItemId, purpose },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
    return usage;
  });
  return NextResponse.json({ status: "ok", usage: event });
}
