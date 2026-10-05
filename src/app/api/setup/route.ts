import { hash } from "bcryptjs";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

const FOUNDATION_PERMISSIONS = [
  ["organization.view", "organization", "View organization settings"],
  ["organization.manage", "organization", "Manage organization settings"],
  ["branches.view", "organization", "View branches"],
  ["branches.manage", "organization", "Manage branches"],
  ["users.view", "identity", "View users"],
  ["users.manage", "identity", "Manage users"],
  ["roles.view", "identity", "View roles and permissions"],
  ["roles.manage", "identity", "Manage roles and permissions"],
  ["audit.view", "audit", "View audit events"],
  ["settings.manage", "organization", "Manage operational settings"],
  ["catalog.view", "catalog", "View test catalog"],
  ["catalog.manage", "catalog", "Manage test catalog"],
  ["catalog.reference_ranges.manage", "catalog", "Manage reference intervals and critical limits"],
  ["patients.view", "patients", "View patients"],
  ["patients.manage", "patients", "Create and update patients"],
  ["clients.view", "clients", "View client accounts"],
  ["clients.manage", "clients", "Manage client accounts"],
  ["referrers.view", "referrers", "View referrers"],
  ["referrers.manage", "referrers", "Manage referrers"],
  ["pricing.view", "billing", "View price lists"],
  ["pricing.manage", "billing", "Manage effective-dated price lists"],
  ["orders.view", "orders", "View laboratory orders"],
  ["orders.create", "orders", "Create laboratory orders"],
  ["billing.view", "billing", "View invoices and balances"],
  ["billing.manage", "billing", "Manage invoices and payments"],
  ["specimens.view", "specimens", "View specimen and barcode traceability"],
  ["specimens.collect", "specimens", "Collect and label specimens"],
  ["specimens.receive", "specimens", "Receive specimens into laboratory custody"],
  ["specimens.reject", "specimens", "Reject unsuitable specimens with reason"],
  ["transfers.view", "specimens", "View inter-branch specimen manifests"],
  ["transfers.create", "specimens", "Create inter-branch specimen manifests"],
  ["transfers.dispatch", "specimens", "Dispatch specimen manifests"],
  ["transfers.receive", "specimens", "Receive specimen manifests and items"],
  ["worklists.view", "laboratory", "View laboratory worklists"],
  ["results.enter", "results", "Enter and save laboratory results"],
  ["results.verify", "results", "Verify laboratory results"],
  ["results.release", "results", "Release verified laboratory results"],
  ["results.amend", "results", "Initiate amendments for released results"],
  ["critical.communicate", "results", "Document critical result communication and acknowledgement"],
  ["reports.view", "reporting", "View diagnostic report versions"],
  ["reports.deliver", "reporting", "Record and perform report delivery actions"],
  ["clinical_rules.manage", "results", "Manage delta-check and other clinical rules"],
  ["result_comments.manage", "results", "Manage reusable result comment templates"],
] as const;

function text(value: unknown, max = 200) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function GET() {
  const userCount = await prisma.user.count();
  return NextResponse.json({ setupRequired: userCount === 0 });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const organizationNameEn = text(body.organizationNameEn);
  const organizationNameAr = text(body.organizationNameAr);
  const branchNameEn = text(body.branchNameEn);
  const branchNameAr = text(body.branchNameAr);
  const displayNameEn = text(body.displayNameEn);
  const displayNameAr = text(body.displayNameAr);
  const username = text(body.username, 100).toLowerCase();
  const password = typeof body.password === "string" ? body.password : "";

  if (!organizationNameEn || !branchNameEn || !displayNameEn || !username || password.length < 12) {
    return NextResponse.json({ error: "missing_or_invalid_fields" }, { status: 400 });
  }
  if (!/^[a-z0-9._-]{3,100}$/.test(username)) {
    return NextResponse.json({ error: "invalid_username" }, { status: 400 });
  }

  const passwordHash = await hash(password, 12);

  try {
    await prisma.$transaction(async (tx) => {
      if (await tx.user.count()) throw new Error("SETUP_ALREADY_COMPLETED");

      const organization = await tx.organization.create({
        data: {
          code: "FAMILY_LAB",
          nameEn: organizationNameEn,
          nameAr: organizationNameAr || null,
        },
      });

      const branch = await tx.branch.create({
        data: {
          organizationId: organization.id,
          code: "MAIN",
          nameEn: branchNameEn,
          nameAr: branchNameAr || null,
          isCentralLab: true,
        },
      });

      await tx.permission.createMany({
        data: FOUNDATION_PERMISSIONS.map(([code, module, description]) => ({ code, module, description })),
        skipDuplicates: true,
      });
      const permissions = await tx.permission.findMany({
        where: { code: { in: FOUNDATION_PERMISSIONS.map(([code]) => code) } },
      });

      const role = await tx.role.create({
        data: {
          organizationId: organization.id,
          code: "SYSTEM_ADMIN",
          nameEn: "System Administrator",
          nameAr: "مدير النظام",
          isSystem: true,
          permissions: {
            create: permissions.map((permission) => ({ permissionId: permission.id })),
          },
        },
      });

      const user = await tx.user.create({
        data: {
          organizationId: organization.id,
          username,
          passwordHash,
          displayNameEn,
          displayNameAr: displayNameAr || null,
          preferredLocale: "en",
          status: "ACTIVE",
          passwordChangedAt: new Date(),
          roles: { create: { roleId: role.id } },
          branchScopes: { create: { branchId: branch.id } },
        },
      });

      await tx.auditEvent.create({
        data: {
          organizationId: organization.id,
          branchId: branch.id,
          actorUserId: user.id,
          action: "SYSTEM_BOOTSTRAPPED",
          entityType: "Organization",
          entityId: organization.id,
          newValues: {
            organizationCode: organization.code,
            branchCode: branch.code,
            adminUsername: username,
          },
          reason: "Initial production setup",
        },
      });
    }, { isolationLevel: "Serializable" });

    return NextResponse.json({ status: "ok" }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "SETUP_ALREADY_COMPLETED") {
      return NextResponse.json({ error: "setup_already_completed" }, { status: 409 });
    }
    return NextResponse.json({ error: "setup_failed" }, { status: 500 });
  }
}
