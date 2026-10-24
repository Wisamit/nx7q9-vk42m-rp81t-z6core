import type { Prisma } from "../../generated/prisma/client";

/**
 * F2 publication is a separate entry point from ordinary catalog editing.
 * Source signatures certify reviewed bytes, not that the referenced live
 * pricing master, test or commercial package remains active at commit time.
 * Caller owns the organization FOR UPDATE lock; these locks must be acquired
 * in the SAME transaction as all native version writes and their audit.
 */
export async function lockF2ActivePriceContext(
  tx: Prisma.TransactionClient,
  organizationId: string,
  kind: "PRICE_LIST_ITEM" | "PRICE_LIST_PACKAGE_ITEM",
  priceListId: string,
  referencedId: string,
): Promise<void> {
  const parents = await tx.$queryRaw<Array<{ id: string; branch_id: string | null }>>`
    SELECT id, branch_id FROM price_lists
    WHERE id=${priceListId} AND organization_id=${organizationId}
      AND status='ACTIVE' FOR UPDATE
  `;
  if (parents.length !== 1) throw Error("f2_apply_price_list_inactive_or_foreign");
  if (parents[0].branch_id !== null) {
    const branches = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM branches WHERE id=${parents[0].branch_id}
        AND organization_id=${organizationId} AND status='ACTIVE' FOR UPDATE
    `;
    if (branches.length !== 1) throw Error("f2_apply_price_branch_inactive_or_foreign");
  }

  if (kind === "PRICE_LIST_ITEM") {
    const tests = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM lab_tests WHERE id=${referencedId}
        AND organization_id=${organizationId} AND status='ACTIVE' FOR UPDATE
    `;
    if (tests.length !== 1) throw Error("f2_apply_price_test_inactive_or_foreign");
    return;
  }
  const packages = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM commercial_packages WHERE id=${referencedId}
      AND organization_id=${organizationId} AND status='ACTIVE' FOR UPDATE
  `;
  if (packages.length !== 1) throw Error("f2_apply_price_package_inactive_or_foreign");
  const members = await tx.$queryRaw<Array<{ test_id: string; organization_id: string; status: string }>>`
    SELECT t.id AS test_id,t.organization_id,t.status
    FROM commercial_package_items pi
    JOIN lab_tests t ON t.id=pi.test_id
    WHERE pi.package_id=${referencedId} ORDER BY t.id FOR UPDATE
  `;
  if (members.some(member => member.organization_id !== organizationId ||
    member.status !== "ACTIVE"))
    throw Error("f2_apply_price_package_member_inactive_or_foreign");
}

/** An F2 interval may be branch-scoped even without any analyzer. Never
 * activate a signed interval after its branch was disabled or reassigned. */
export async function lockF2ActiveReferenceBranch(
  tx: Prisma.TransactionClient, organizationId: string, branchId: string | null,
): Promise<void> {
  if (branchId === null) return;
  const branches = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM branches WHERE id=${branchId}
      AND organization_id=${organizationId} AND status='ACTIVE' FOR UPDATE
  `;
  if (branches.length !== 1) throw Error("f2_apply_range_branch_inactive_or_foreign");
}
