import { NextResponse } from "next/server";
import { canAccessBranch, canAccessDepartment, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { MicrobiologyEditRejected, requireEditableMicrobiologyCase } from "@/lib/microbiology-case-lock";

function text(value: unknown, max = 5000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("microbiology.enter");
  const ctx = await requestContext();
  const { id } = await params;
  const body = await request.json().catch(() => null) as {
    cultureStatus?: string;
    preliminaryComment?: string;
    markPreliminary?: boolean;
  } | null;
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const cultureStatus = ["PENDING","NO_GROWTH","GROWTH","MIXED_GROWTH","CONTAMINATED"].includes(body.cultureStatus || "")
    ? body.cultureStatus as "PENDING" | "NO_GROWTH" | "GROWTH" | "MIXED_GROWTH" | "CONTAMINATED"
    : null;
  if (!cultureStatus) return NextResponse.json({ error: "invalid_culture_status" }, { status: 400 });

  const microbiologyCase = await prisma.microbiologyCase.findFirst({
    where: { id, organizationId: session.user.organizationId },
    include: { orderItem: { include: { test: { select: { departmentId: true } } } } },
  });
  if (!microbiologyCase) return NextResponse.json({ error: "microbiology_case_not_found" }, { status: 404 });
  if (!canAccessBranch(session, microbiologyCase.performingBranchId)) {
    return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });
  }
  if (!canAccessDepartment(session, microbiologyCase.orderItem.test.departmentId)) {
    return NextResponse.json({ error: "department_forbidden" }, { status: 403 });
  }
  if (["FINAL","CANCELLED"].includes(microbiologyCase.status)) {
    return NextResponse.json({ error: "microbiology_case_locked", status: microbiologyCase.status }, { status: 409 });
  }

  const preliminaryComment = text(body.preliminaryComment);
  const status = body.markPreliminary === true ? "PRELIMINARY" : "IN_PROGRESS";

  const updated = await prisma.$transaction(async tx => {
    await requireEditableMicrobiologyCase(tx, {
      organizationId: session.user.organizationId,
      caseId: microbiologyCase.id,
      specimenId: microbiologyCase.specimenId,
      performingBranchId: microbiologyCase.performingBranchId,
      expectedCaseUpdatedAt: microbiologyCase.updatedAt,
    });
    const item = await tx.microbiologyCase.update({
      where: { id },
      data: {
        cultureStatus,
        preliminaryComment: preliminaryComment || null,
        status,
      },
    });

    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: microbiologyCase.performingBranchId,
        actorUserId: session.user.id,
        action: body.markPreliminary === true ? "MICROBIOLOGY_PRELIMINARY_UPDATED" : "MICROBIOLOGY_CULTURE_STATUS_UPDATED",
        entityType: "MicrobiologyCase",
        entityId: id,
        oldValues: {
          cultureStatus: microbiologyCase.cultureStatus,
          status: microbiologyCase.status,
          preliminaryComment: microbiologyCase.preliminaryComment,
        },
        newValues: { cultureStatus, status, preliminaryComment: preliminaryComment || null },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });

    return item;
  }).catch(error => {
    if (error instanceof MicrobiologyEditRejected) return error;
    throw error;
  });
  if (updated instanceof MicrobiologyEditRejected) {
    return NextResponse.json({ error: updated.code }, { status: 409 });
  }

  return NextResponse.json({ status: "ok", case: updated });
}
