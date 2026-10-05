import { NextResponse } from "next/server";
import { requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";

function text(value: unknown, max = 255) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function overlaps(aStart: Date, aEnd: Date | null, bStart: Date, bEnd: Date | null) {
  return (aEnd === null || bStart <= aEnd) && (bEnd === null || aStart <= bEnd);
}

export async function POST(request: Request) {
  const session = await requirePermission("integrations.manage");
  const ctx = await requestContext();
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const testId = text(body.testId, 36);
  const componentId = text(body.componentId, 36) || null;
  const scope = componentId ? "COMPONENT" : "TEST";
  const system = ["LOINC","SNOMED_CT","ICD10","LOCAL"].includes(body.system) ? body.system : "LOINC";
  const code = text(body.code, 80);
  const display = text(body.display, 255) || null;
  const systemVersion = text(body.systemVersion, 80) || null;
  const isPrimary = body.isPrimary !== false;
  const effectiveFrom = new Date(String(body.effectiveFrom || ""));
  const effectiveTo = body.effectiveTo ? new Date(String(body.effectiveTo)) : null;

  if (!testId || !code || Number.isNaN(effectiveFrom.getTime())) {
    return NextResponse.json({ error: "missing_required_fields" }, { status: 400 });
  }
  if (effectiveTo && (Number.isNaN(effectiveTo.getTime()) || effectiveTo < effectiveFrom)) {
    return NextResponse.json({ error: "invalid_effective_dates" }, { status: 400 });
  }

  const test = await prisma.labTest.findFirst({
    where: { id: testId, organizationId: session.user.organizationId, status: "ACTIVE" },
    include: { components: { where: { status: "ACTIVE" }, select: { id: true } } },
  });
  if (!test) return NextResponse.json({ error: "test_not_found" }, { status: 404 });
  if (componentId && !test.components.some(component => component.id === componentId)) {
    return NextResponse.json({ error: "component_not_in_test" }, { status: 409 });
  }

  if (isPrimary) {
    const existing = await prisma.terminologyMapping.findMany({
      where: {
        organizationId: session.user.organizationId,
        testId,
        componentId,
        system,
        isPrimary: true,
        status: "ACTIVE",
      },
      select: { effectiveFrom: true, effectiveTo: true },
    });
    if (existing.some(item => overlaps(effectiveFrom, effectiveTo, item.effectiveFrom, item.effectiveTo))) {
      return NextResponse.json({ error: "overlapping_primary_mapping" }, { status: 409 });
    }
  }

  const mapping = await prisma.$transaction(async tx => {
    const created = await tx.terminologyMapping.create({
      data: {
        organizationId: session.user.organizationId,
        scope,
        testId,
        componentId,
        system,
        code,
        display,
        systemVersion,
        isPrimary,
        effectiveFrom,
        effectiveTo,
        createdByUserId: session.user.id,
      },
    });
    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: session.activeBranchId,
        actorUserId: session.user.id,
        action: "TERMINOLOGY_MAPPING_CREATED",
        entityType: "TerminologyMapping",
        entityId: created.id,
        newValues: { scope, testId, componentId, system, code, display, systemVersion, isPrimary, effectiveFrom, effectiveTo },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
    return created;
  });

  return NextResponse.json({ status: "ok", mapping }, { status: 201 });
}
