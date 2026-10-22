import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getCurrentPortalSession } from "@/lib/portal-auth";
import { requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { resolveBranchLocalDateTime } from "@/lib/branch-local-date-time";
import {
  evaluatePortalBookingReplay,portalBookingIntentHash,portalBookingSubmissionKey,
  portalBookingReceipt,
} from "@/lib/portal-appointment-idempotency";

function text(value: unknown, max = 5000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function POST(request: Request) {
  const session = await getCurrentPortalSession();
  if (!session || session.portalAccount.mustChangePassword) {
    return NextResponse.json({ error: "portal_unauthorized" }, { status: 401 });
  }
  const account = session.portalAccount;
  if (account.type === "DOCTOR") {
    return NextResponse.json({ error: "doctor_booking_not_enabled" }, { status: 403 });
  }

  const ctx = await requestContext();
  const submission = portalBookingSubmissionKey(
    request.headers.get("x-family-lab-portal-appointment-key"),
  );
  if (!submission.valid) {
    return NextResponse.json({ error: "invalid_portal_appointment_key" }, { status: 400 });
  }
  const body = await request.json().catch(() => null);
  const branchId = text(body?.branchId, 36);
  const requestedPatientId = text(body?.patientId, 36);
  const mode = body?.mode === "HOME_COLLECTION" ? "HOME_COLLECTION" : "ONSITE";
  const serviceCode = text(body?.serviceCode, 80) || null;
  const serviceNameSnapshot = text(body?.serviceNameSnapshot, 220);
  // New portal UI submits branch-local wall time; preserve explicit UTC/offset
  // scheduledStart for existing API integrations without reinterpreting it.
  const address = text(body?.address, 5000) || null;
  const notes = text(body?.notes, 5000) || null;

  if (!branchId || !serviceNameSnapshot) {
    return NextResponse.json({ error: "invalid_booking_request" }, { status: 400 });
  }
  if (mode === "HOME_COLLECTION" && !address) {
    return NextResponse.json({ error: "home_collection_address_required" }, { status: 400 });
  }

  let patientId = account.patientId || requestedPatientId;
  if (account.type === "CORPORATE") {
    if (!requestedPatientId) return NextResponse.json({ error: "patient_required" }, { status: 400 });
    const access = await prisma.corporatePortalPatientAccess.findFirst({
      where: {
        clientId: account.clientId!,
        patientId: requestedPatientId,
        canBook: true,
        status: "ACTIVE",
        effectiveFrom: { lte: new Date() },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: new Date() } }],
      },
    });
    if (!access) return NextResponse.json({ error: "corporate_patient_not_authorized_for_booking" }, { status: 403 });
    patientId = requestedPatientId;
  }
  if (!patientId) return NextResponse.json({ error: "patient_required" }, { status: 400 });

  const [branch, patient] = await Promise.all([
    prisma.branch.findFirst({ where: { id: branchId, organizationId: account.organizationId, status: "ACTIVE" } }),
    prisma.patient.findFirst({ where: { id: patientId, organizationId: account.organizationId, status: "ACTIVE" } }),
  ]);
  if (!branch || !patient) return NextResponse.json({ error: "branch_or_patient_not_found" }, { status: 404 });

  const usesBranchClock = body?.scheduledStartLocal !== undefined;
  // Fingerprint the exact normalized portal booking intent BEFORE considering
  // the current clock. Replaying a committed booking tomorrow must not
  // create a second booking or fail because its original time has passed.
  const payloadHash = submission.key
    ? portalBookingIntentHash({
      portalAccountId: account.id,
      branchId, patientId, mode,
      serviceCode, serviceNameSnapshot,
      address, notes,
      timeSource: usesBranchClock ? "BRANCH_LOCAL" : "INSTANT",
      requestedTime: usesBranchClock
        ? String(body.scheduledStartLocal ?? "") : String(body?.scheduledStart ?? ""),
    }) : null;

  const replayResponse = async (): Promise<NextResponse | null> => {
    if (!submission.key || !payloadHash) return null;
    const existing = await prisma.appointment.findFirst({
      where: {
        organizationId: account.organizationId,
        portalAccountId: account.id,
        portalSubmissionKey: submission.key,
      },
      select: {
        id: true, branchId: true, patientId: true, status: true,
        portalSubmissionHash: true, appointmentNumber: true,
      },
    });
    const decision = evaluatePortalBookingReplay(existing, payloadHash);
    if (decision.kind === "new") return null;
    if (decision.kind === "conflict") {
      return NextResponse.json({ error: "portal_appointment_key_conflict" }, {
        status: 409, headers: { "Cache-Control": "private, no-store" },
      });
    }
    // Replay does not create another home-collection task or audit event.
    return NextResponse.json({
      status: "ok", replayed: true,
      appointment: portalBookingReceipt(existing!),
    }, { status: 200, headers: { "Cache-Control": "private, no-store" } });
  };
  const earlierSubmission = await replayResponse();
  if (earlierSubmission) return earlierSubmission;

  const scheduledStart = usesBranchClock
    ? (typeof body?.scheduledStartLocal === "string"
      ? resolveBranchLocalDateTime(body.scheduledStartLocal, branch.timezone) : null)
    : new Date(String(body?.scheduledStart || ""));
  if (!scheduledStart || !Number.isFinite(scheduledStart.getTime()) || scheduledStart <= new Date()) {
    return NextResponse.json({
      error: usesBranchClock ? "invalid_branch_local_schedule" : "invalid_booking_request",
    }, { status: 400 });
  }

  const datePart = scheduledStart.toISOString().slice(0,10).replaceAll("-","");
  const appointmentNumber = `${branch.code}-WEB-${datePart}-${randomUUID().slice(0,8).toUpperCase()}`;

  let appointment;
  try {
    appointment = await prisma.$transaction(async tx => {
    const created = await tx.appointment.create({
      data: {
        organizationId: account.organizationId,
        branchId,
        patientId,
        portalAccountId: account.id,
        portalSubmissionKey: submission.key,
        portalSubmissionHash: payloadHash,
        appointmentNumber,
        mode,
        serviceCode,
        serviceNameSnapshot,
        scheduledStart,
        status: "REQUESTED",
        contactPhoneSnapshot: patient.phone || account.phone,
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
        organizationId: account.organizationId,
        branchId,
        actorUserId: null,
        action: "PORTAL_APPOINTMENT_REQUESTED",
        entityType: "Appointment",
        entityId: created.id,
        sessionId: session.id,
        newValues: { appointmentNumber, patientId, mode, serviceCode, serviceNameSnapshot, scheduledStart },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
    return created;
    });
  } catch (error) {
    if (submission.key && error && typeof error === "object" &&
        "code" in error && error.code === "P2002") {
      // Concurrent identical keys race on the physical MariaDB UNIQUE index.
      // The losing transaction rolls back its visit and audit writes.
      const existing = await replayResponse();
      if (existing) return existing;
    }
    throw error;
  }

  // A successful booking is an acknowledgment, not a patient-detail read.
  // The fixed allowlist excludes PII and internal tenant/audit/key metadata.
  return NextResponse.json({
    status: "ok",
    appointment: portalBookingReceipt(appointment),
  }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
}
