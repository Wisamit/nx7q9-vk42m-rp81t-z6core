import { NextResponse } from "next/server";
import { canAccessBranch, getCurrentSession, permissionSet, requestContext } from "@/lib/auth";
import { parseExactTaxPublicationInput } from "@/lib/tax-publication-input";
import { lockLiveTaxPublicationAuthority, TaxPublicationAuthorityError } from "@/lib/tax-publication-authority";
import { taxLineAmounts, taxScopeKey, validTaxRate } from "@/lib/tax-policy";
import { prisma } from "@/lib/db";

export async function POST(request: Request) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!permissionSet(session).has("billing.tax.manage")) {
    return NextResponse.json({ error: "tax_authority_forbidden" }, { status: 403 });
  }
  const body: unknown = await request.json().catch(() => null);
  const admission = parseExactTaxPublicationInput(body);
  if (!admission.ok) {
    return NextResponse.json({ error: admission.error }, { status: 400 });
  }
  const {
    branchId, serviceType, serviceId, code, nameEn, nameAr,
    treatment, priceMode, ratePercent, effectiveFrom, reason,
  } = admission.value;
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
      // The earlier preflight is for a helpful initial error only. A live
      // administrator may revoke a role or branch grant or retire the service
      // while this request waits. Recheck current authority while locking
      // the tenant and all impacted tax configuration versions in THIS
      // transaction, before writing the immutable rule and audit event.
      await lockLiveTaxPublicationAuthority(tx, {
        userId: session.user.id,
        organizationId: session.user.organizationId,
        sessionBranchIds: session.user.branchScopes
          .filter(scope => scope.branch.status === "ACTIVE")
          .map(scope => scope.branchId),
        branchId, serviceType, serviceId,
      });
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
    if (error instanceof TaxPublicationAuthorityError) {
      return NextResponse.json({ error: error.code }, { status: error.status });
    }
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
      return NextResponse.json({ error: "tax_rule_revision_exists" }, { status: 409 });
    }
    throw error;
  }
}
