import type { Prisma } from "../../generated/prisma/client";

export class SpecimenOrderNoLongerActive extends Error {
  constructor() { super("SPECIMEN_ORDER_NO_LONGER_ACTIVE"); }
}

/**
 * Lock the canonical order before altering preanalytical specimen records.
 * The original page/preflight order status must not authorize a late receipt
 * or material-volume rewrite after an order was cancelled or completed.
 */
export async function requireActiveSpecimenOrder(
  tx: Prisma.TransactionClient,
  organizationId: string,
  orderId: string,
) {
  const rows = await tx.$queryRaw<Array<{ status: string }>>`
    SELECT status FROM orders
    WHERE id = ${orderId} AND organization_id = ${organizationId}
    FOR UPDATE
  `;
  if (rows.length !== 1 || !["REGISTERED", "COLLECTED", "IN_PROGRESS"].includes(rows[0].status)) {
    throw new SpecimenOrderNoLongerActive();
  }
}
