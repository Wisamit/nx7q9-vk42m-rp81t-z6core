import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession, permissionSet } from "@/lib/auth";
import { prisma } from "@/lib/db";

function decimal(value: unknown) {
  if (value === "" || value === null || value === undefined) return null;
  const text = String(value).trim();
  return /^-?\d+(\.\d+)?$/.test(text) ? text : undefined;
}

export async function POST(request: NextRequest) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!permissionSet(session).has("catalog.reference_ranges.manage")) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await request.json().catch(() => null);
  const componentId = typeof body?.componentId === "string" ? body.componentId : "";
  const component = await prisma.testComponent.findFirst({ where: { id: componentId, test: { organizationId: session.user.organizationId } } });
  if (!component) return NextResponse.json({ error: "component_not_found" }, { status: 404 });

  const ageFrom = decimal(body.ageFrom), ageTo = decimal(body.ageTo), lowValue = decimal(body.lowValue), highValue = decimal(body.highValue), criticalLow = decimal(body.criticalLow), criticalHigh = decimal(body.criticalHigh);
  if ([ageFrom, ageTo, lowValue, highValue, criticalLow, criticalHigh].some(v => v === undefined)) return NextResponse.json({ error: "invalid_numeric_value" }, { status: 400 });
  if (lowValue !== null && highValue !== null && Number(lowValue) > Number(highValue)) return NextResponse.json({ error: "invalid_range" }, { status: 400 });
  if (criticalLow !== null && criticalHigh !== null && Number(criticalLow) > Number(criticalHigh)) return NextResponse.json({ error: "invalid_critical_range" }, { status: 400 });

  const effectiveFrom = body.effectiveFrom ? new Date(body.effectiveFrom) : new Date();
  if (Number.isNaN(effectiveFrom.getTime())) return NextResponse.json({ error: "invalid_effective_date" }, { status: 400 });

  try {
    const interval = await prisma.$transaction(async (tx) => {
      const created = await tx.referenceInterval.create({ data: {
        componentId, branchId: body.branchId || null, methodId: body.methodId || null,
        sex: ["MALE","FEMALE"].includes(body.sex) ? body.sex : "ANY",
        ageFrom, ageTo, ageUnit: ["DAY","WEEK","MONTH","YEAR"].includes(body.ageUnit) ? body.ageUnit : null,
        lowValue, highValue,
        normalTextEn: typeof body.normalTextEn === "string" ? body.normalTextEn.trim() || null : null,
        normalTextAr: typeof body.normalTextAr === "string" ? body.normalTextAr.trim() || null : null,
        criticalLow, criticalHigh,
        source: typeof body.source === "string" ? body.source.trim() || null : null,
        notes: typeof body.notes === "string" ? body.notes.trim() || null : null,
        effectiveFrom, approvedByUserId: session.userId, approvedAt: new Date(),
      }});
      await tx.auditEvent.create({ data: { organizationId: session.user.organizationId, branchId: session.activeBranchId, actorUserId: session.userId, action: "REFERENCE_INTERVAL_CREATED", entityType: "ReferenceInterval", entityId: created.id, newValues: { componentId, sex: created.sex, ageFrom, ageTo, lowValue, highValue, criticalLow, criticalHigh, effectiveFrom: effectiveFrom.toISOString() } } });
      return created;
    });
    return NextResponse.json({ interval }, { status: 201 });
  } catch { return NextResponse.json({ error: "create_failed" }, { status: 409 }); }
}
