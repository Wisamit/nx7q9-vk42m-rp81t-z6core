import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession, permissionSet } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { manualUnitIdentityError, manualUnitInputError } from "@/lib/catalog-manual-unit-governance";

const resources = {
  departments: prisma.department,
  specimens: prisma.specimenType,
  containers: prisma.container,
  methods: prisma.method,
  units: prisma.unit,
} as const;

class ManualUnitConflict extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code);
  }
}

export async function POST(request: NextRequest) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!permissionSet(session).has("catalog.manage")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const type = typeof body?.type === "string" ? body.type : "";
  const code = typeof body?.code === "string" ? body.code.trim().toUpperCase() : "";
  const nameEn = typeof body?.nameEn === "string" ? body.nameEn.trim() : "";
  const nameAr = typeof body?.nameAr === "string" ? body.nameAr.trim() : "";
  if (!(type in resources) || !code || !nameEn || !/^[A-Z0-9._-]{1,50}$/.test(code)) {
    return NextResponse.json({ error: "invalid_fields" }, { status: 400 });
  }

  // Only manual units share identities with legacy unit preparation and safe
  // master commits. Both of those flows lock the tenant organization first.
  if (type === "units") {
    const candidate = {
      code, nameEn, nameAr,
      symbol: typeof body.symbol === "string" ? body.symbol.trim() : "",
      ucumCode: typeof body.ucumCode === "string" ? body.ucumCode.trim() : "",
    };
    const inputError = manualUnitInputError(candidate);
    if (inputError) return NextResponse.json({ error: inputError }, { status: 400 });
    if (!session.activeBranchId) {
      return NextResponse.json({ error: "active_branch_required" }, { status: 403 });
    }
    try {
      const record = await prisma.$transaction(async tx => {
        const organization = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM organizations
          WHERE id = ${session.user.organizationId} AND status = 'ACTIVE' FOR UPDATE
        `;
        if (organization.length !== 1) throw new ManualUnitConflict("organization_inactive", 403);
        const branch = await tx.branch.findFirst({
          where: { id: session.activeBranchId!, organizationId: session.user.organizationId, status: "ACTIVE" },
          select: { id: true },
        });
        const grant = await tx.userBranchScope.findUnique({
          where: { userId_branchId: { userId: session.userId, branchId: session.activeBranchId! } },
          select: { branchId: true },
        });
        if (!branch || !grant) throw new ManualUnitConflict("branch_forbidden", 403);

        const currentUnits = await tx.unit.findMany({
          where: { organizationId: session.user.organizationId },
          select: { id: true, code: true, symbol: true, status: true },
        });
        const conflict = manualUnitIdentityError(currentUnits, candidate);
        if (conflict) throw new ManualUnitConflict(conflict, 409);

        const created = await tx.unit.create({
          data: {
            organizationId: session.user.organizationId, code: candidate.code,
            symbol: candidate.symbol, nameEn: candidate.nameEn,
            nameAr: candidate.nameAr || null, ucumCode: candidate.ucumCode || null,
          },
        });
        await tx.auditEvent.create({
          data: {
            organizationId: session.user.organizationId, branchId: branch.id,
            actorUserId: session.userId, action: "CATALOG_MASTER_CREATED",
            entityType: "units", entityId: created.id,
            newValues: { code: created.code, nameEn: created.nameEn, symbol: created.symbol },
          },
        });
        return created;
      }, { timeout: 60000 });
      return NextResponse.json({ record }, { status: 201 });
    } catch (error) {
      if (error instanceof ManualUnitConflict) {
        return NextResponse.json({ error: error.code }, { status: error.status });
      }
      return NextResponse.json({ error: "create_failed" }, { status: 409 });
    }
  }

  // Existing organization masters retain their business behavior. Creating
  // the record and audit together prevents an unaudited committed master.
  try {
    const record = await prisma.$transaction(async tx => {
      let created: { id: string; code: string };
      if (type === "departments") {
        created = await tx.department.create({ data: { organizationId: session.user.organizationId, code, nameEn, nameAr: nameAr || null } });
      } else if (type === "specimens") {
        created = await tx.specimenType.create({ data: { organizationId: session.user.organizationId, code, nameEn, nameAr: nameAr || null } });
      } else if (type === "containers") {
        created = await tx.container.create({
          data: {
            organizationId: session.user.organizationId, code, nameEn, nameAr: nameAr || null,
            tubeColor: typeof body.tubeColor === "string" ? body.tubeColor.trim() || null : null,
            additive: typeof body.additive === "string" ? body.additive.trim() || null : null,
          },
        });
      } else if (type === "methods") {
        created = await tx.method.create({ data: { organizationId: session.user.organizationId, code, nameEn, nameAr: nameAr || null } });
      } else {
        throw new Error("unsupported_master_type");
      }
      await tx.auditEvent.create({
        data: {
          organizationId: session.user.organizationId, branchId: session.activeBranchId,
          actorUserId: session.userId, action: "CATALOG_MASTER_CREATED",
          entityType: type, entityId: created.id, newValues: { code: created.code, nameEn },
        },
      });
      return created;
    });
    return NextResponse.json({ record }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "create_failed" }, { status: 409 });
  }
}
