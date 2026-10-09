import { NextResponse } from "next/server";
import { canAccessBranch, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";

function text(value: unknown, max = 1000) { return typeof value === "string" ? value.trim().slice(0,max) : ""; }

export async function POST(request: Request) {
  const session = await requirePermission("resilience.manage");
  const ctx = await requestContext();
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  const branchId = text(body.branchId,36) || null;
  const provider = text(body.provider,160);
  const backupReference = text(body.backupReference,500);
  const status = ["RECORDED","VERIFIED","FAILED"].includes(body.status) ? body.status : "RECORDED";
  const backupCreatedAt = new Date(String(body.backupCreatedAt || ""));
  const restoreTestedAt = body.restoreTestedAt ? new Date(String(body.restoreTestedAt)) : null;
  const restoreDurationMinutes = body.restoreDurationMinutes === "" || body.restoreDurationMinutes == null ? null : Number(body.restoreDurationMinutes);
  const evidenceReference = text(body.evidenceReference,1000) || null;
  const notes = text(body.notes,5000) || null;

  if (!provider || !backupReference || Number.isNaN(backupCreatedAt.getTime())) return NextResponse.json({ error:"missing_required_fields" },{status:400});
  if (restoreTestedAt && Number.isNaN(restoreTestedAt.getTime())) return NextResponse.json({error:"invalid_restore_time"},{status:400});
  if (restoreDurationMinutes !== null && (!Number.isInteger(restoreDurationMinutes) || restoreDurationMinutes < 0)) return NextResponse.json({error:"invalid_restore_duration"},{status:400});
  if (backupCreatedAt.getTime() > Date.now()) return NextResponse.json({error:"backup_time_in_future"},{status:400});
  if (restoreTestedAt && (restoreTestedAt < backupCreatedAt || restoreTestedAt.getTime() > Date.now())) {
    return NextResponse.json({error:"restore_time_outside_backup_history"},{status:400});
  }
  if (status === "VERIFIED" && (!restoreTestedAt || !evidenceReference || restoreDurationMinutes === null)) {
    return NextResponse.json({error:"verified_backup_requires_restore_evidence_and_duration"},{status:409});
  }
  if (branchId && !canAccessBranch(session,branchId)) return NextResponse.json({error:"branch_forbidden"},{status:403});

  const record=await prisma.$transaction(async tx=>{
    const created=await tx.backupVerification.create({data:{
      organizationId:session.user.organizationId,branchId,provider,backupReference,backupCreatedAt,status,
      restoreTestedAt,restoreDurationMinutes,evidenceReference,notes,recordedByUserId:session.user.id,
    }});
    await tx.auditEvent.create({data:{
      organizationId:session.user.organizationId,branchId:branchId||session.activeBranchId,actorUserId:session.user.id,
      action:"BACKUP_VERIFICATION_RECORDED",entityType:"BackupVerification",entityId:created.id,
      newValues:{provider,backupReference,backupCreatedAt,status,restoreTestedAt,restoreDurationMinutes,evidenceReference},
      reason:"Evidence record only; LIS does not claim the external backup exists beyond supplied verification evidence.",
      ipAddress:ctx.ipAddress,userAgent:ctx.userAgent,
    }});
    return created;
  });
  return NextResponse.json({status:"ok",record},{status:201});
}
