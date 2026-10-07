import { NextResponse } from "next/server";
import { getCurrentSession, permissionSet, requestContext } from "@/lib/auth";
import { validCreditLimit } from "@/lib/client-credit-control";
import { prisma } from "@/lib/db";

function text(value: unknown, length: number) {
  return typeof value === "string" ? value.trim().slice(0, length) : "";
}

function hasOrganizationBranchScope(session: {
  user: { branchScopes: Array<{ branchId: string; branch: { status: string } }>; organizationId: string };
}, activeBranchIds: string[]) {
  const accessible = new Set(session.user.branchScopes.filter(scope => scope.branch.status === "ACTIVE").map(scope => scope.branchId));
  return activeBranchIds.length > 0 && activeBranchIds.every(id => accessible.has(id));
}

export async function PUT(request: Request) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!permissionSet(session).has("billing.credit.limits.manage")) {
    return NextResponse.json({ error: "credit_authority_forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const clientId = text(body.clientId, 36);
  const currency = text(body.currency, 3).toUpperCase();
  const mode = body.mode === "DISABLED" || body.mode === "WARN" || body.mode === "BLOCK" ? body.mode : null;
  const limitAmount = validCreditLimit(body.limitAmount);
  const reason = text(body.reason, 1000);
  if (!clientId || !/^[A-Z]{3}$/.test(currency) || !mode || limitAmount === null || !reason) {
    return NextResponse.json({ error: "invalid_credit_policy_fields" }, { status: 400 });
  }

  const [activeBranches, client] = await Promise.all([
    prisma.branch.findMany({
      where: { organizationId: session.user.organizationId, status: "ACTIVE" },
      select: { id: true },
    }),
    prisma.client.findFirst({
      where: { organizationId: session.user.organizationId, id: clientId, status: "ACTIVE" },
      select: { id: true, code: true, creditControlVersion: true },
    }),
  ]);
  if (!hasOrganizationBranchScope(session, activeBranches.map(branch => branch.id))) {
    return NextResponse.json({ error: "organization_scope_incomplete" }, { status: 403 });
  }
  if (!client) return NextResponse.json({ error: "client_not_found" }, { status: 404 });

  const ctx = await requestContext();
  try {
    const policy = await prisma.$transaction(async tx => {
      const guarded = await tx.client.updateMany({
        where: {
          id: clientId,
          organizationId: session.user.organizationId,
          status: "ACTIVE",
          creditControlVersion: client.creditControlVersion,
        },
        data: { creditControlVersion: { increment: 1 } },
      });
      if (guarded.count !== 1) return null;

      const key = { organizationId: session.user.organizationId, clientId, currency };
      const previous = await tx.clientCreditPolicy.findUnique({
        where: { organizationId_clientId_currency: key },
      });

      const result = await tx.clientCreditPolicy.upsert({
        where: { organizationId_clientId_currency: key },
        update: {
          mode,
          limitAmount,
          reason,
          updatedByUserId: session.user.id,
        },
        create: {
          ...key,
          mode,
          limitAmount,
          reason,
          createdByUserId: session.user.id,
          updatedByUserId: session.user.id,
        },
      });
      await tx.auditEvent.create({
        data: {
          organizationId: session.user.organizationId,
          branchId: session.activeBranchId,
          actorUserId: session.user.id,
          action: previous ? "CLIENT_CREDIT_POLICY_UPDATED" : "CLIENT_CREDIT_POLICY_CREATED",
          entityType: "ClientCreditPolicy",
          entityId: result.id,
          reason,
          oldValues: previous ? {
            clientId,
            currency,
            mode: previous.mode,
            limitAmount: previous.limitAmount.toFixed(4),
          } : undefined,
          newValues: {
            clientId,
            clientCode: client.code,
            currency,
            mode,
            limitAmount,
            clientCreditVersion: client.creditControlVersion + 1,
          },
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
      });
      return result;
    }, { timeout: 30000 });

    if (!policy) return NextResponse.json({ error: "client_credit_state_changed" }, { status: 409 });
    return NextResponse.json({
      status: "ok",
      policyId: policy.id,
      clientId: policy.clientId,
      currency: policy.currency,
      mode: policy.mode,
      limitAmount: policy.limitAmount.toFixed(4),
    });
  } catch (error) {
    // Concurrent unique-key inserts are rejected without changing the previous policy.
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
      return NextResponse.json({ error: "client_credit_state_changed" }, { status: 409 });
    }
    throw error;
  }
}
