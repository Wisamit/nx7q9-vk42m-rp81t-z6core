import type { Prisma } from "../../generated/prisma/client";

/** Reject stale order/test status before creating or advancing clinical result history. */
export class ResultOrderStateChanged extends Error {
  constructor() { super("RESULT_ORDER_STATE_CHANGED"); }
}

export async function lockResultOrderState(
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    orderId: string;
    orderItemId: string;
    mode: "ENTRY" | "REVIEW" | "RELEASE";
  },
) {
  // Lock canonical order first, then item, then caller can lock specimens
  // and the actual result. A cancellation must serialize with this workflow.
  const orders = await tx.$queryRaw<Array<{ status: string }>>`
    SELECT status FROM orders
    WHERE id = ${input.orderId} AND organization_id = ${input.organizationId}
    FOR UPDATE
  `;
  const items = await tx.$queryRaw<Array<{ status: string }>>`
    SELECT status FROM order_items
    WHERE id = ${input.orderItemId} AND order_id = ${input.orderId}
    FOR UPDATE
  `;
  if (orders.length !== 1 || items.length !== 1) throw new ResultOrderStateChanged();

  const orderStatus = orders[0].status;
  const itemStatus = items[0].status;
  if (orderStatus === "CANCELLED" || itemStatus === "CANCELLED") {
    throw new ResultOrderStateChanged();
  }
  if (input.mode === "ENTRY" && (
      !["REGISTERED", "COLLECTED", "IN_PROGRESS"].includes(orderStatus) ||
      !["ORDERED", "COLLECTED", "IN_PROGRESS", "RESULTED"].includes(itemStatus))) {
    throw new ResultOrderStateChanged();
  }
  if (input.mode === "REVIEW" && itemStatus === "VERIFIED") {
    throw new ResultOrderStateChanged();
  }
  return { orderStatus, itemStatus };
}
