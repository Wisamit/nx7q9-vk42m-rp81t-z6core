import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { canAccessBranch, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";

function text(value: unknown, max = 1000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function POST(request: Request) {
  const session = await requirePermission("appointments.manage");
  const ctx = await requestContext();
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const branchId = text(body.branchId, 36);
  const patientId = text(body.patientId, 36);
  const mode = body.mode === "HOME_COLLECTION" ? "HOME_COLLECTION" : "ONSITE";
  const serviceCode = text(body.serviceCode, 80) || null;
  const serviceNameSnapshot = text(body.serviceNameSnapshot, 220);
  const scheduledStart = new Date(String(body.scheduledStart || ""));
  const scheduledEnd = body.scheduledEnd ? new Date(String(body.scheduledEnd)) : null;
  const phone = text(body.contactPhone, 50) || null;
  const address = text(body.address, 5000) || null;
  const notes = text(body.notes, 5000) || null;

  if (!branchId || !patientId || !serviceNameSnapshot || Number.isNaN(scheduledStart.getTime())) {
    return NextResponse.json({ error: "missing_required_fields" }, { status: 400 });
  }
  if (scheduledEnd && (Number.isNaN(scheduledEnd.getTime()) || scheduledEnd <= scheduledStart)) {
    return NextResponse.json({ error: "invalid_schedule_window" }, { status: 400 });
  }
  if (mode === "HOME_COLLECTION" && !address) {
    return NextResponse.json({ error: "home_collection_address_required" }, { status: 400 });
  }
  if (!canAccessBranch(session, branchId)) {
    return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });
  }

  const [branch, patient] = await Promise.all([
    prisma.branch.findFirst({ where: { id: branchId, organizationId: session.user.organizationId, status: "ACTIVE" } }),
    prisma.patient.findFirst({ where: { id: patientId, organizationId: session.user.organizationId, status: "ACTIVE" } }),
  ]);
  if (!branch || !patient) return NextResponse.json({ error: "branch_or_patient_not_found" }, { status: 404 });

  const datePart = scheduledStart.toISOString().slice(0,10).replaceAll("-","");
  const appointmentNumber = `${branch.code}-APT-${datePart}-${randomUUID().slice(0,8).toUpperCase()}`;

  const appointment = await prisma.$transaction(async tx => {
    const created = await tx.appointment.create({
      data: {
        organizationId: session.user.organizationId,
        branchId,
        patientId,
        createdByUserId: session.user.id,
        appointmentNumber,
        mode,
        serviceCode,
        serviceNameSnapshot,
        scheduledStart,
        scheduledEnd,
        status: "CONFIRMED",
        contactPhoneSnapshot: phone || patient.phone,
        addressSnapshot: address,
        notes,
      },
    });
    if (mode === "HOME_COLLECTION") {
      await tx.homeCollectionVisit.create({
        data: { appointmentId: created.id, branchId, status: "SCHEDULED" },
      });
    }
    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId,
        actorUserId: session.user.id,
        action: "APPOINTMENT_CREATED",
        entityType: "Appointment",
        entityId: created.id,
        newValues: { appointmentNumber, patientId, mode, serviceCode, serviceNameSnapshot, scheduledStart, scheduledEnd },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
    return created;
  });

  return NextResponse.json({ status: "ok", appointment }, { status: 201 });
}
