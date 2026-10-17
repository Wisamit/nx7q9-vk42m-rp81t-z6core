import type { Prisma } from "../../generated/prisma/client.ts";

/** Evaluate CURRENT user, role, permission and exact branch grants at commit time. */
export function liveSafeMasterCommitActorWhere(
  userId: string, organizationId: string, branchId: string,
): Prisma.UserWhereInput {
  return {
    id: userId, organizationId, status: "ACTIVE",
    roles: { some: { role: {
      organizationId, status: "ACTIVE",
      permissions: { some: { permission: { code: "catalog.manage" } } },
    } } },
    branchScopes: { some: {
      branchId, branch: { organizationId, status: "ACTIVE" },
    } },
  };
}
