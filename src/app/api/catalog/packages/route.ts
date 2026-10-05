import { NextResponse } from "next/server";
import { requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";

function text(value: unknown, max = 500) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
function ids(value: unknown) {
  return Array.isArray(value) ? [...new Set(value.filter((x): x is string => typeof x === "string" && x.length > 0))] : [];
}

export async function POST(request: Request) {
  const session = await requirePermission("catalog.manage");
  const ctx = await requestContext();
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const code = text(body.code, 80).toUpperCase();
  const nameEn = text(body.nameEn, 220);
  const nameAr = text(body.nameAr, 220) || null;
  const descriptionEn = text(body.descriptionEn, 5000) || null;
  const descriptionAr = text(body.descriptionAr, 5000) || null;
  const testIds = ids(body.testIds);

  if (!code || !nameEn || testIds.length === 0) {
    return NextResponse.json({ error: "missing_required_fields" }, { status: 400 });
  }

  const tests = await prisma.labTest.findMany({
    where: {
      organizationId: session.user.organizationId,
      id: { in: testIds },
      status: "ACTIVE",
    },
    select: { id: true, code: true },
  });
  if (tests.length !== testIds.length) {
    return NextResponse.json({ error: "one_or_more_tests_not_found" }, { status: 404 });
  }

  const duplicate = await prisma.commercialPackage.findUnique({
    where: { organizationId_code: { organizationId: session.user.organizationId, code } },
    select: { id: true },
  });
  if (duplicate) return NextResponse.json({ error: "package_code_exists" }, { status: 409 });

  const created = await prisma.$transaction(async tx => {
    const pkg = await tx.commercialPackage.create({
      data: {
        organizationId: session.user.organizationId,
        code,
        nameEn,
        nameAr,
        descriptionEn,
        descriptionAr,
      },
    });

    await tx.commercialPackageItem.createMany({
      data: testIds.map((testId, index) => ({
        packageId: pkg.id,
        testId,
        displayOrder: index,
      })),
    });

    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: session.activeBranchId,
        actorUserId: session.user.id,
        action: "COMMERCIAL_PACKAGE_CREATED",
        entityType: "CommercialPackage",
        entityId: pkg.id,
        newValues: { code, nameEn, testIds },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });

    return pkg;
  });

  return NextResponse.json({ status: "ok", package: created }, { status: 201 });
}
