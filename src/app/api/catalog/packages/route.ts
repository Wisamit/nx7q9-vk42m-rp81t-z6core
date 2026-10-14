import { NextResponse } from "next/server";
import { requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  CompositeWriteError, parseCompositeMembers, withScopedCompositeCreation,
} from "@/lib/catalog-composite-write";

function optionalText(value: unknown, max: number) {
  return value === undefined || value === null || value === ""
    ? null
    : typeof value === "string" && value.trim().length <= max ? value.trim() || null : undefined;
}
export async function POST(request: Request) {
  const session = await requirePermission("catalog.manage");
  const ctx = await requestContext();
  const data = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!data || Array.isArray(data) || typeof data !== "object")
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  const code = typeof data.code === "string" ? data.code.trim().toUpperCase() : "";
  const nameEn = typeof data.nameEn === "string" ? data.nameEn.trim() : "";
  const nameAr = optionalText(data.nameAr, 220);
  const descriptionEn = optionalText(data.descriptionEn, 5000);
  const descriptionAr = optionalText(data.descriptionAr, 5000);
  if (!/^[A-Z0-9._-]{1,80}$/.test(code) || !nameEn || nameEn.length > 220 ||
      nameAr === undefined || descriptionEn === undefined || descriptionAr === undefined)
    return NextResponse.json({ error: "invalid_fields" }, { status: 400 });
  try {
    const members = parseCompositeMembers(data, "PACKAGE");
    const created = await withScopedCompositeCreation(session, members.map(m => m.testId), async tx => {
      const existing = await tx.commercialPackage.findUnique({
        where: { organizationId_code: { organizationId: session.user.organizationId, code } },
        select: { id: true },
      });
      if (existing) throw new CompositeWriteError("package_code_exists", 409);
      const pkg = await tx.commercialPackage.create({ data: {
        organizationId: session.user.organizationId, code, nameEn, nameAr,
        descriptionEn, descriptionAr,
      } });
      await tx.commercialPackageItem.createMany({ data: members.map(member => ({
        packageId: pkg.id, testId: member.testId, displayOrder: member.displayOrder,
      })) });
      await tx.auditEvent.create({ data: {
        organizationId: session.user.organizationId, branchId: session.activeBranchId,
        actorUserId: session.user.id, action: "COMMERCIAL_PACKAGE_CREATED",
        entityType: "CommercialPackage", entityId: pkg.id,
        newValues: { code, nameEn, members,
          authorizedBranchId: session.activeBranchId, scopedMembership: true },
        ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
      } });
      return pkg;
    });
    return NextResponse.json({ status: "ok", package: created }, { status: 201 });
  } catch (error) {
    if (error instanceof CompositeWriteError)
      return NextResponse.json({ error: error.code }, { status: error.status });
    // MariaDB's tenant-level uniqueness still protects competing writers.
    if (error && typeof error === "object" && "code" in error &&
        error.code === "P2002")
      return NextResponse.json({ error: "package_code_exists" }, { status: 409 });
    throw error;
  }
}
