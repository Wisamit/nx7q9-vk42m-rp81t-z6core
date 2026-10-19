import type { Prisma } from "../../generated/prisma/client";

export class TransferOrderNoLongerActive extends Error {
  constructor() { super("TRANSFER_ORDER_NO_LONGER_ACTIVE"); }
}

/**
 * Serialize a new manifest or physical dispatch against order cancellation.
 * Lock distinct parent orders in stable order before specimen/manifest writes.
 * Receiving material already in transit must never use this gate.
 */
export async function lockActiveTransferOrders(
  tx: Prisma.TransactionClient,
  organizationId: string,
  orderIds: readonly string[],
) {
  const distinct = [...new Set(orderIds)].sort();
  if (distinct.length === 0) throw new TransferOrderNoLongerActive();
  for (const orderId of distinct) {
    const rows = await tx.$queryRaw<Array<{ status: string }>>`
      SELECT status FROM orders
      WHERE id = ${orderId} AND organization_id = ${organizationId}
      FOR UPDATE
    `;
    if (rows.length !== 1 ||
        !["REGISTERED", "COLLECTED", "IN_PROGRESS"].includes(rows[0].status)) {
      throw new TransferOrderNoLongerActive();
    }
  }
}
