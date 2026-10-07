import { NextResponse } from "next/server";
import { canAccessBranch, getCurrentSession, permissionSet, requestContext } from "@/lib/auth";
import { nextDateString } from "@/lib/client-accounting";
import { taxLineAmounts, taxScopeKey, validTaxRate } from "@/lib/tax-policy";
import { prisma } from "@/lib/db";

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function POST(request: Request) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!permissionSet(session).has("billing.tax.manage")) {
    return NextResponse.json({ error: "tax_authority_forbidden" }, { status: 403 });
  }
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const branchId = text(body.branchId, 36) || null;
  const serviceType = body.serviceType === "TEST" || body.serviceType === "PACKAGE" ? body.serviceType : null;
  const serviceId = text(body.serviceId, 36);
  const code = text(body.code, 60).toUpperCase();
  const nameEn = text(body.nameEn, 200);
  const nameAr = text(body.nameAr, 200);
  const treatment = ["STANDARD", "ZERO_RATED", "EXEMPT"].includes(String(body.treatment))
    ? body.treatment as "STANDARD" | "ZERO_RATED" | "EXEMPT" : null;
  const priceMode = body.priceMode === "EXCLUSIVE" || body.priceMode === "INCLUSIVE" ? body.priceMode : null;
  const ratePercent = validTaxRate(body.ratePercent);
  const effectiveFrom = text(body.effectiveFrom, 10);
  const reason = text(body.reason, 1000);
  if (!serviceType || !serviceId || !/^[A-Z0-9_-]{2,60}$/.test(code) || !nameEn || !treatment || !priceMode
    || ratePercent === null || !nextDateString(effectiveFrom) || !reason) {
    return NextResponse.json({ error: "invalid_tax_fields" }, { status: 400 });
  }
  if (!taxLineAmounts({ netAfterDiscount: "1.0000", rule: { treatment, priceMode, ratePercent } })) {
    return NextResponse.json({ error: "invalid_tax_treatment_rate" }, { status: 400 });
  }
  const [activeBranches, service] = await Promise.all([
    prisma.branch.findMany({
      where: { organizationId: session.user.organizationId, status: "ACTIVE" },
      select: { id: true },
    }),
    serviceType === "TEST"
      ? prisma.labTest.findFirst({ where: { id: serviceId, organizationId: session.user.organizationId, status: "ACTIVE" }, select: { id: true } })
      : prisma.commercialPackage.findFirst({ where: { id: serviceId, organizationId: session.user.organizationId, status: "ACTIVE" }, select: { id: true } }),
  ]);
  if (!service) return NextResponse.json({ error: "tax_service_not_found" }, { status: 404 });
  const activeIds = activeBranches.map(item => item.id);
  if (branchId) {
    if (!activeIds.includes(branchId)) return NextResponse.json({ error: "branch_not_found" }, { status: 404 });
    if (!canAccessBranch(session, branchId)) return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });
  } else {
    const scopes = new Set(session.user.branchScopes.filter(item => item.branch.status === "ACTIVE").map(item => item.branchId));
    if (!activeIds.length || activeIds.some(id => !scopes.has(id))) {
      return NextResponse.json({ error: "organization_scope_incomplete" }, { status: 403 });
    }
  }

  const ctx = await requestContext();
  const scopeKey = taxScopeKey(branchId, serviceType, serviceId);
  try {
    const rule = await prisma.$transaction(async tx => {
      // Serialize publication against concurrent invoice issuance in every affected branch.
      if (branchId) {
        await tx.branch.updateMany({
          where: { id: branchId, organizationId: session.user.organizationId, status: "ACTIVE" },
          data: { taxConfigVersion: { increment: 1 } },
        });
      } else {
        await tx.branch.updateMany({
          where: { organizationId: session.user.organizationId, status: "ACTIVE" },
          data: { taxConfigVersion: { increment: 1 } },
        });
      }
      const created = await tx.taxRule.create({
        data: {
          organizationId: session.user.organizationId,
          branchId,
          testId: serviceType === "TEST" ? serviceId : null,
          packageId: serviceType === "PACKAGE" ? serviceId : null,
          scopeKey,
          code,
          nameEn,
          nameAr: nameAr || null,
          treatment,
          priceMode,
          ratePercent,
          effectiveFrom: new Date(effectiveFrom + "T00:00:00.000Z"),
          reason,
          createdByUserId: session.user.id,
        },
      });
      await tx.auditEvent.create({
        data: {
          organizationId: session.user.organizationId,
          branchId,
          actorUserId: session.user.id,
          action: "TAX_RULE_PUBLISHED",
          entityType: "TaxRule",
          entityId: created.id,
          reason,
          newValues: { scopeKey, serviceType, serviceId, branchId, code, treatment, priceMode, ratePercent, effectiveFrom },
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
      });
      return created;
    }, { timeout: 30000 });
    return NextResponse.json({ status: "ok", ruleId: rule.id, scopeKey: rule.scopeKey }, { status: 201 });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
      return NextResponse.json({ error: "tax_rule_revision_exists" }, { status: 409 });
    }
    throw error;
  }
}
