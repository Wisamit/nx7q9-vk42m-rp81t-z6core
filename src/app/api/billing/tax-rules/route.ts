import { NextResponse } from "next/server";
import { getCurrentSession, permissionSet, requestContext } from "@/lib/auth";
import { parseExactTaxPublicationInput } from "@/lib/tax-publication-input";
import { taxLineAmounts, taxScopeKey } from "@/lib/tax-policy";
import { lockTaxPublicationAuthority, TaxPublicationGateError } from "@/lib/tax-publication-live-authority";
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

  const ctx = await requestContext();
  const scopeKey = taxScopeKey(branchId, serviceType, serviceId);
  try {
    const rule = await prisma.$transaction(async tx => {
      // Recheck current ACTIVE tenant/role/grants/branches/service under the
      // SAME transaction that writes the effective tax revision and audit.
      const authority = await lockTaxPublicationAuthority(tx, {
        organizationId: session.user.organizationId,
        userId: session.user.id,
        branchId, serviceType, serviceId,
        sessionBranchIds: session.user.branchScopes
          .filter(scope => scope.branch.status === "ACTIVE")
          .map(scope => scope.branchId),
      });
      if (!authority.ok) {
        throw new TaxPublicationGateError(authority.error, authority.status);
      }
      // Serialize against concurrent invoice issuance; verify expected branch
      // count so a changed activation/scope cannot yield a partial revision.
      const revision = await tx.branch.updateMany({
        where: {
          organizationId: session.user.organizationId, status: "ACTIVE",
          ...(branchId ? { id: branchId } : {}),
        },
        data: { taxConfigVersion: { increment: 1 } },
      });
      if (revision.count !== authority.affectedBranches) {
        throw new TaxPublicationGateError("tax_branch_state_changed", 409);
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
    if (error instanceof TaxPublicationGateError) {
      return NextResponse.json({ error: error.errorCode }, { status: error.status });
    }
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
      return NextResponse.json({ error: "tax_rule_revision_exists" }, { status: 409 });
    }
    throw error;
  }
}
