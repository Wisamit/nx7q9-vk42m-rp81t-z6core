import { NextResponse } from "next/server";
import { requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";

const DATA_CLASSES = ["ANALYZER_MESSAGES","INTEGRATION_MESSAGES","WEBHOOK_DELIVERIES","PORTAL_SESSIONS","USER_SESSIONS","AUDIT_EVENTS","CLINICAL_RESULTS","DIAGNOSTIC_REPORTS"] as const;
const SAFE_PURGE = new Set(["PORTAL_SESSIONS","USER_SESSIONS"]);
const PROTECTED = new Set(["AUDIT_EVENTS","CLINICAL_RESULTS","DIAGNOSTIC_REPORTS"]);

export async function POST(request: Request) {
  const session = await requirePermission("resilience.manage");
  const ctx = await requestContext();
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const dataClass = DATA_CLASSES.includes(body.dataClass) ? body.dataClass : null;
  let action = ["ARCHIVE","PURGE","RETAIN_ONLY"].includes(body.action) ? body.action : "RETAIN_ONLY";
  const retainDays = body.retainDays === "" || body.retainDays == null ? null : Number(body.retainDays);
  const archiveAfterDays = body.archiveAfterDays === "" || body.archiveAfterDays == null ? null : Number(body.archiveAfterDays);
  const enabled = body.enabled === true;
  const notes = typeof body.notes === "string" ? body.notes.trim().slice(0,1000) || null : null;

  if (!dataClass) return NextResponse.json({ error: "invalid_data_class" }, { status: 400 });
  if (PROTECTED.has(dataClass)) action = "RETAIN_ONLY";
  if (action === "PURGE" && !SAFE_PURGE.has(dataClass)) {
    return NextResponse.json({ error: "automatic_purge_not_allowed_for_data_class" }, { status: 409 });
  }
  if (retainDays !== null && (!Number.isInteger(retainDays) || retainDays < 30 || retainDays > 36500)) {
    return NextResponse.json({ error: "invalid_retain_days" }, { status: 400 });
  }
  if (archiveAfterDays !== null && (!Number.isInteger(archiveAfterDays) || archiveAfterDays < 30 || archiveAfterDays > 36500)) {
    return NextResponse.json({ error: "invalid_archive_days" }, { status: 400 });
  }

  const policy = await prisma.$transaction(async tx => {
    const existing = await tx.retentionPolicy.findUnique({
      where: { organizationId_dataClass: { organizationId: session.user.organizationId, dataClass } },
    });
    const saved = await tx.retentionPolicy.upsert({
      where: { organizationId_dataClass: { organizationId: session.user.organizationId, dataClass } },
      update: { action, retainDays, archiveAfterDays, enabled, notes },
      create: {
        organizationId: session.user.organizationId,
        dataClass,
        action,
        retainDays,
        archiveAfterDays,
        enabled,
        notes,
        createdByUserId: session.user.id,
      },
    });
    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: session.activeBranchId,
        actorUserId: session.user.id,
        action: "RETENTION_POLICY_UPSERTED",
        entityType: "RetentionPolicy",
        entityId: saved.id,
        oldValues: existing ? {
          action: existing.action, retainDays: existing.retainDays,
          archiveAfterDays: existing.archiveAfterDays, enabled: existing.enabled,
        } : undefined,
        newValues: { dataClass, action, retainDays, archiveAfterDays, enabled },
        reason: PROTECTED.has(dataClass) ? "Protected clinical/audit class forced to RETAIN_ONLY" : notes,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
    return saved;
  });
  return NextResponse.json({ status: "ok", policy });
}
