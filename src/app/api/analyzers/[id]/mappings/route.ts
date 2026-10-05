import { NextResponse } from "next/server";
import { canAccessBranch, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";

function text(value: unknown, max = 200) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function overlaps(aStart: Date, aEnd: Date | null, bStart: Date, bEnd: Date | null) {
  return (aEnd === null || bStart <= aEnd) && (bEnd === null || aStart <= bEnd);
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("analyzers.manage");
  const ctx = await requestContext();
  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const analyzerTestCode = text(body.analyzerTestCode, 120);
  const analyzerUnitCode = text(body.analyzerUnitCode, 80) || null;
  const testId = text(body.testId, 36);
  const componentId = text(body.componentId, 36) || null;
  const effectiveFrom = new Date(String(body.effectiveFrom || ""));
  const effectiveTo = body.effectiveTo ? new Date(String(body.effectiveTo)) : null;

  if (!analyzerTestCode || !testId || Number.isNaN(effectiveFrom.getTime())) {
    return NextResponse.json({ error: "missing_required_fields" }, { status: 400 });
  }
  if (effectiveTo && (Number.isNaN(effectiveTo.getTime()) || effectiveTo < effectiveFrom)) {
    return NextResponse.json({ error: "invalid_effective_dates" }, { status: 400 });
  }

  const analyzer = await prisma.analyzer.findFirst({
    where: { id, organizationId: session.user.organizationId, status: "ACTIVE" },
  });
  if (!analyzer) return NextResponse.json({ error: "analyzer_not_found" }, { status: 404 });
  if (!canAccessBranch(session, analyzer.branchId)) return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });

  const [test, existing] = await Promise.all([
    prisma.labTest.findFirst({
      where: { id: testId, organizationId: session.user.organizationId, status: "ACTIVE" },
      include: { components: { where: { status: "ACTIVE" } } },
    }),
    prisma.analyzerTestMapping.findMany({
      where: { analyzerId: analyzer.id, analyzerTestCode, status: "ACTIVE" },
      select: { id: true, effectiveFrom: true, effectiveTo: true },
    }),
  ]);
  if (!test) return NextResponse.json({ error: "test_not_found" }, { status: 404 });
  if (componentId && !test.components.some(component => component.id === componentId)) {
    return NextResponse.json({ error: "component_not_found_for_test" }, { status: 409 });
  }
  if (test.components.length > 0 && !componentId) {
    return NextResponse.json({ error: "component_required_for_multi_component_test" }, { status: 409 });
  }
  if (existing.some(mapping => overlaps(effectiveFrom, effectiveTo, mapping.effectiveFrom, mapping.effectiveTo))) {
    return NextResponse.json({ error: "overlapping_analyzer_mapping" }, { status: 409 });
  }

  const mapping = await prisma.$transaction(async tx => {
    const created = await tx.analyzerTestMapping.create({
      data: {
        analyzerId: analyzer.id,
        analyzerTestCode,
        analyzerUnitCode,
        testId,
        componentId,
        effectiveFrom,
        effectiveTo,
      },
    });
    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: analyzer.branchId,
        actorUserId: session.user.id,
        action: "ANALYZER_TEST_MAPPING_CREATED",
        entityType: "AnalyzerTestMapping",
        entityId: created.id,
        newValues: { analyzerId: analyzer.id, analyzerTestCode, analyzerUnitCode, testId, componentId, effectiveFrom, effectiveTo },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
    return created;
  });

  return NextResponse.json({ status: "ok", mapping }, { status: 201 });
}
