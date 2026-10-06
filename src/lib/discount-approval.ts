import { compare } from "bcryptjs";
import type { Prisma, PrismaClient } from "../../generated/prisma/client";
import { effectiveDiscountLimit, approverCanAuthorize } from "@/lib/discount-policy";
import { decryptSecret, verifyTotp } from "@/lib/staff-mfa";

type DbClient = PrismaClient | Prisma.TransactionClient;

export async function verifyDiscountApprover(
  db: DbClient,
  input: {
    organizationId: string;
    branchId: string;
    username: string;
    password: string;
    mfaCode?: string | null;
    requestedPercent: number;
  },
) {
  const username = input.username.trim().toLowerCase();
  if (!username || !input.password) {
    return { ok: false as const, error: "discount_approval_required" };
  }

  const user = await db.user.findFirst({
    where: {
      organizationId: input.organizationId,
      username,
      status: "ACTIVE",
    },
    include: {
      roles: {
        include: {
          role: {
            include: {
              permissions: { include: { permission: true } },
            },
          },
        },
      },
      branchScopes: { include: { branch: true } },
    },
  });

  if (!user?.passwordHash) {
    return { ok: false as const, error: "discount_approver_invalid" };
  }

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    return { ok: false as const, error: "discount_approver_locked" };
  }

  const passwordValid = await compare(input.password, user.passwordHash);
  if (!passwordValid) {
    return { ok: false as const, error: "discount_approver_invalid" };
  }

  const activeRoles = user.roles.filter(assignment => assignment.role.status === "ACTIVE");
  const permissions = new Set(
    activeRoles.flatMap(assignment => assignment.role.permissions.map(grant => grant.permission.code)),
  );
  const branchAllowed = user.branchScopes.some(scope =>
    scope.branchId === input.branchId && scope.branch.status === "ACTIVE"
  );
  const limitPercent = effectiveDiscountLimit({
    userOverride: user.discountLimitPercent,
    roleLimits: activeRoles.map(assignment => assignment.role.discountLimitPercent),
  });

  if (!approverCanAuthorize({
    requestedPercent: input.requestedPercent,
    approverLimitPercent: limitPercent,
    hasApprovalPermission: permissions.has("billing.discount.approve"),
    branchAllowed,
  })) {
    return { ok: false as const, error: "discount_approver_not_authorized" };
  }

  if (user.mfaEnabled) {
    if (!user.mfaSecretEncrypted) {
      return { ok: false as const, error: "discount_approver_mfa_invalid" };
    }
    const code = (input.mfaCode || "").trim();
    if (!code) {
      return { ok: false as const, error: "discount_approver_mfa_required" };
    }
    if (!verifyTotp(decryptSecret(user.mfaSecretEncrypted), code)) {
      return { ok: false as const, error: "discount_approver_mfa_invalid" };
    }
  }

  return {
    ok: true as const,
    approver: {
      id: user.id,
      username: user.username,
      displayNameEn: user.displayNameEn,
      displayNameAr: user.displayNameAr,
      limitPercent,
    },
  };
}
