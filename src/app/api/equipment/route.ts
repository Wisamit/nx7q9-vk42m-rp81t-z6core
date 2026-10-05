import { NextResponse } from "next/server";
import { canAccessBranch, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";

function text(value: unknown, max = 1000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function date(value: unknown) {
  if (!value) return null;
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) throw new Error("INVALID_DATE");
  return parsed;
}

export async function POST(request: Request) {
  const session = await requirePermission("equipment.manage");
  const ctx = await requestContext();
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const branchId = text(body.branchId, 36);
  const departmentId = text(body.departmentId, 36) || null;
  const analyzerId = text(body.analyzerId, 36) || null;
  const assetId = text(body.assetId, 100).toUpperCase();
  const name = text(body.name, 220);

  if (!branchId || !assetId || !name) {
    return NextResponse.json({ error: "missing_required_fields" }, { status: 400 });
  }
  if (!canAccessBranch(session, branchId)) {
    return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });
  }

  let installationDate: Date | null;
  let warrantyUntil: Date | null;
  try {
    installationDate = date(body.installationDate);
    warrantyUntil = date(body.warrantyUntil);
  } catch {
    return NextResponse.json({ error: "invalid_date" }, { status: 400 });
  }

  const [branchRecord, department, analyzer] = await Promise.all([
    prisma.branch.findFirst({ where: { id: branchId, organizationId: session.user.organizationId, status: "ACTIVE" } }),
    departmentId
      ? prisma.department.findFirst({ where: { id: departmentId, organizationId: session.user.organizationId, status: "ACTIVE" } })
      : Promise.resolve(null),
    analyzerId
      ? prisma.analyzer.findFirst({ where: { id: analyzerId, organizationId: session.user.organizationId, status: "ACTIVE" } })
      : Promise.resolve(null),
  ]);

  if (!branchRecord) return NextResponse.json({ error: "branch_not_found" }, { status: 404 });
  if (departmentId && !department) return NextResponse.json({ error: "department_not_found" }, { status: 404 });
  if (department && department.branchId && department.branchId !== branchId) {
    return NextResponse.json({ error: "department_branch_mismatch" }, { status: 409 });
  }
  if (analyzerId && !analyzer) return NextResponse.json({ error: "analyzer_not_found" }, { status: 404 });
  if (analyzer && analyzer.branchId !== branchId) {
    return NextResponse.json({ error: "analyzer_branch_mismatch" }, { status: 409 });
  }
  if (analyzer && departmentId && analyzer.departmentId && analyzer.departmentId !== departmentId) {
    return NextResponse.json({ error: "analyzer_department_mismatch" }, { status: 409 });
  }

  try {
    const equipment = await prisma.$transaction(async tx => {
      const created = await tx.equipment.create({
        data: {
          organizationId: session.user.organizationId,
          branchId,
          departmentId,
          analyzerId,
          assetId,
          name,
          manufacturer: text(body.manufacturer, 150) || null,
          model: text(body.model, 150) || null,
          serialNumber: text(body.serialNumber, 150) || null,
          installationDate,
          warrantyUntil,
          serviceVendor: text(body.serviceVendor, 220) || null,
          locationText: text(body.locationText, 220) || null,
          notes: text(body.notes, 5000) || null,
        },
      });

      await tx.auditEvent.create({
        data: {
          organizationId: session.user.organizationId,
          branchId,
          actorUserId: session.user.id,
          action: "EQUIPMENT_CREATED",
          entityType: "Equipment",
          entityId: created.id,
          newValues: {
            assetId,
            name,
            branchId,
            departmentId,
            analyzerId,
            manufacturer: created.manufacturer,
            model: created.model,
            serialNumber: created.serialNumber,
            installationDate,
            warrantyUntil,
          },
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
      });

      return created;
    });

    return NextResponse.json({ status: "ok", equipment }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "equipment_create_failed" }, { status: 409 });
  }
}
