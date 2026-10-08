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
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const observationType = ["GRAM_STAIN","MICROSCOPY","CULTURE","COLONY_COUNT","OTHER"].includes(body.observationType)
    ? body.observationType
    : null;
  const observationText = text(body.observationText);
  if (!observationType || !observationText) return NextResponse.json({ error: "missing_required_fields" }, { status: 400 });

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

  const observation = await prisma.$transaction(async tx => {
    await requireEditableMicrobiologyCase(tx, {
      organizationId: session.user.organizationId,
      caseId: microbiologyCase.id,
      specimenId: microbiologyCase.specimenId,
      performingBranchId: microbiologyCase.performingBranchId,
    });
    const created = await tx.cultureObservation.create({
      data: {
        caseId: microbiologyCase.id,
        observationType,
        observationText,
        enteredByUserId: session.user.id,
      },
    });
    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: microbiologyCase.performingBranchId,
        actorUserId: session.user.id,
        action: "MICROBIOLOGY_OBSERVATION_ADDED",
        entityType: "CultureObservation",
        entityId: created.id,
        newValues: { caseId: id, observationType, observationText },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
    return created;
  }).catch(error => {
    if (error instanceof MicrobiologyEditRejected) return error;
    throw error;
  });
  if (observation instanceof MicrobiologyEditRejected) {
    return NextResponse.json({ error: observation.code }, { status: 409 });
  }

  return NextResponse.json({ status: "ok", observation }, { status: 201 });
}
