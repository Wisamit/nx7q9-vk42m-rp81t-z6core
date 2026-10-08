import { NextResponse } from "next/server";
import { canAccessBranch, canAccessDepartment, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { MicrobiologyEditRejected, requireEditableMicrobiologyCase } from "@/lib/microbiology-case-lock";

function text(value: unknown, max = 1000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function POST(request: Request, { params }: { params: Promise<{ isolateId: string }> }) {
  const session = await requirePermission("microbiology.enter");
  const ctx = await requestContext();
  const { isolateId } = await params;
  const body = await request.json().catch(() => null) as {
    method?: string;
    comments?: string;
    results?: Array<{
      antibioticId?: string;
      interpretation?: string;
      micValue?: string | number | null;
      micUnit?: string;
      zoneDiameterMm?: string | number | null;
      breakpointSnapshot?: string;
    }>;
  } | null;
  if (!body || !Array.isArray(body.results) || body.results.length === 0) {
    return NextResponse.json({ error: "susceptibility_results_required" }, { status: 400 });
  }

  const isolate = await prisma.microbiologyIsolate.findFirst({
    where: {
      id: isolateId,
      case: { organizationId: session.user.organizationId },
    },
    include: { case: { include: { orderItem: { include: { test: { select: { departmentId: true } } } } } }, organism: true },
  });
  if (!isolate) return NextResponse.json({ error: "isolate_not_found" }, { status: 404 });
  if (!canAccessBranch(session, isolate.case.performingBranchId)) {
    return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });
  }
  if (!canAccessDepartment(session, isolate.case.orderItem.test.departmentId)) {
    return NextResponse.json({ error: "department_forbidden" }, { status: 403 });
  }
  if (["FINAL","CANCELLED"].includes(isolate.case.status)) {
    return NextResponse.json({ error: "microbiology_case_locked", status: isolate.case.status }, { status: 409 });
  }

  const ids = [...new Set(body.results.map(item => text(item.antibioticId, 36)).filter(Boolean))];
  if (ids.length !== body.results.length) {
    return NextResponse.json({ error: "invalid_or_duplicate_antibiotic" }, { status: 400 });
  }
  const antibiotics = await prisma.antibiotic.findMany({
    where: { id: { in: ids }, organizationId: session.user.organizationId, status: "ACTIVE" },
  });
  if (antibiotics.length !== ids.length) return NextResponse.json({ error: "antibiotic_not_found" }, { status: 404 });
  const byId = new Map(antibiotics.map(item => [item.id, item]));

  const prepared: Array<{
    antibiotic: (typeof antibiotics)[number];
    interpretation: "S" | "I" | "R" | "NON_SUSCEPTIBLE" | "UNKNOWN";
    micValue: number | null;
    micUnit: string | null;
    zoneDiameterMm: number | null;
    breakpointSnapshot: string | null;
  }> = [];
  for (const item of body.results) {
    const antibioticId = text(item.antibioticId, 36);
    const antibiotic = byId.get(antibioticId);
    const interpretation = ["S","I","R","NON_SUSCEPTIBLE","UNKNOWN"].includes(item.interpretation || "")
      ? item.interpretation as "S" | "I" | "R" | "NON_SUSCEPTIBLE" | "UNKNOWN"
      : "UNKNOWN";
    const micValue = item.micValue === "" || item.micValue == null ? null : Number(item.micValue);
    const zoneDiameterMm = item.zoneDiameterMm === "" || item.zoneDiameterMm == null ? null : Number(item.zoneDiameterMm);
    if (!antibiotic || (micValue !== null && !Number.isFinite(micValue)) || (zoneDiameterMm !== null && !Number.isFinite(zoneDiameterMm))) {
      return NextResponse.json({ error: "invalid_susceptibility_value", antibioticId }, { status: 400 });
    }
    prepared.push({
      antibiotic,
      interpretation,
      micValue,
      micUnit: text(item.micUnit, 40) || null,
      zoneDiameterMm,
      breakpointSnapshot: text(item.breakpointSnapshot, 255) || null,
    });
  }

  const susceptibilityTest = await prisma.$transaction(async tx => {
    await requireEditableMicrobiologyCase(tx, {
      organizationId: session.user.organizationId,
      caseId: isolate.case.id,
      specimenId: isolate.case.specimenId,
      performingBranchId: isolate.case.performingBranchId,
      expectedCaseUpdatedAt: isolate.case.updatedAt,
    });
    const created = await tx.susceptibilityTest.create({
      data: {
        isolateId,
        method: text(body.method, 150) || null,
        comments: text(body.comments, 5000) || null,
        enteredByUserId: session.user.id,
      },
    });

    for (const item of prepared) {
      await tx.susceptibilityResult.create({
        data: {
          susceptibilityTestId: created.id,
          antibioticId: item.antibiotic.id,
          antibioticCodeSnapshot: item.antibiotic.code,
          antibioticNameEnSnapshot: item.antibiotic.nameEn,
          antibioticNameArSnapshot: item.antibiotic.nameAr,
          interpretation: item.interpretation,
          micValue: item.micValue,
          micUnit: item.micUnit,
          zoneDiameterMm: item.zoneDiameterMm,
          breakpointSnapshot: item.breakpointSnapshot,
        },
      });
    }

    await tx.microbiologyCase.update({
      where: { id: isolate.case.id },
      data: { updatedAt: new Date(Math.max(Date.now(), isolate.case.updatedAt.getTime() + 1)) },
    });
    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: isolate.case.performingBranchId,
        actorUserId: session.user.id,
        action: "MICROBIOLOGY_SUSCEPTIBILITY_RECORDED",
        entityType: "SusceptibilityTest",
        entityId: created.id,
        newValues: {
          caseId: isolate.caseId,
          isolateId,
          organismCode: isolate.organism.code,
          method: created.method,
          results: prepared.map(item => ({
            antibioticCode: item.antibiotic.code,
            interpretation: item.interpretation,
            micValue: item.micValue,
            zoneDiameterMm: item.zoneDiameterMm,
          })),
        },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });

    return created;
  }).catch(error => {
    if (error instanceof MicrobiologyEditRejected) return error;
    throw error;
  });
  if (susceptibilityTest instanceof MicrobiologyEditRejected) {
    return NextResponse.json({ error: susceptibilityTest.code }, { status: 409 });
  }

  return NextResponse.json({ status: "ok", susceptibilityTestId: susceptibilityTest.id }, { status: 201 });
}
