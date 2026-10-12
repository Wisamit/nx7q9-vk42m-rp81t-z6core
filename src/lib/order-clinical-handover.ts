import { createHash } from "node:crypto";
import type { Prisma } from "../../generated/prisma/client";

export class ClinicalHandoverError extends Error {
  readonly code: string;
  readonly statusCode: number;
  constructor(code: string, statusCode = 409) {
    super(code);
    this.code = code;
    this.statusCode = statusCode;
  }
}
export function isClinicalUuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
export const categories = [
  "CLINICAL_CONTEXT", "COLLECTION_INSTRUCTION", "LAB_HANDOVER", "QUALITY_CAUTION",
] as const;
export type ClinicalHandoverInput = {
  clientRequestId: string;
  category: (typeof categories)[number];
  language: "ar" | "en";
  body: string;
  requiresAcknowledgement: boolean;
  replacesNoteId: string | null;
  correctionReason: string | null;
};
export function validClinicalReason(value: unknown): value is string {
  return typeof value === "string" && value.trim().length >= 10 &&
    value.trim().length <= 1000 && !/[\u0000-\u001f\u007f]/.test(value);
}
export function parseClinicalHandoverInput(raw: unknown): ClinicalHandoverInput {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new ClinicalHandoverError("invalid_request", 400);
  const v = raw as Record<string, unknown>;
  if (!isClinicalUuid(v.clientRequestId))
    throw new ClinicalHandoverError("invalid_idempotency_key", 400);
  if (!categories.includes(v.category as ClinicalHandoverInput["category"]) ||
      (v.language !== "ar" && v.language !== "en") ||
      typeof v.requiresAcknowledgement !== "boolean")
    throw new ClinicalHandoverError("invalid_handover_metadata", 400);
  if (typeof v.body !== "string" || v.body.trim().length < 2 ||
      v.body.trim().length > 4000 ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v.body))
    throw new ClinicalHandoverError("invalid_handover_text", 400);
  const replacesNoteId = v.replacesNoteId === null || v.replacesNoteId === undefined
    ? null : v.replacesNoteId;
  if (replacesNoteId !== null && !isClinicalUuid(replacesNoteId))
    throw new ClinicalHandoverError("invalid_replaced_note", 400);
  if (replacesNoteId && !validClinicalReason(v.correctionReason))
    throw new ClinicalHandoverError("correction_reason_required", 400);
  if (!replacesNoteId && v.correctionReason)
    throw new ClinicalHandoverError("unexpected_correction_reason", 400);
  return {
    clientRequestId: v.clientRequestId as string,
    category: v.category as ClinicalHandoverInput["category"],
    language: v.language as "ar" | "en",
    body: v.body.trim(),
    requiresAcknowledgement: v.requiresAcknowledgement as boolean,
    replacesNoteId,
    correctionReason: replacesNoteId ? (v.correctionReason as string).trim() : null,
  };
}
export function clinicalHandoverFingerprint(orderId: string, data: ClinicalHandoverInput) {
  return createHash("sha256").update(JSON.stringify({
    orderId,
    category: data.category,
    language: data.language,
    body: data.body,
    requiresAcknowledgement: data.requiresAcknowledgement,
    replacesNoteId: data.replacesNoteId,
    correctionReason: data.correctionReason,
  })).digest("hex");
}

/** All writers lock the same order before touching notes or acknowledgements. */
export async function lockClinicalOrder(tx: Prisma.TransactionClient, args: {
  orderId: string; organizationId: string; actorId: string; activeBranchId: string | null;
  scopedBranchIds: string[];
}) {
  const rows = await tx.$queryRaw<Array<{ id:string; ordering_branch_id:string; status:string }>>`
    SELECT id, ordering_branch_id, status FROM orders
    WHERE id=${args.orderId} AND organization_id=${args.organizationId}
    FOR UPDATE
  `;
  if (rows.length !== 1) throw new ClinicalHandoverError("order_not_found",404);
  const order = rows[0];
  if (!args.scopedBranchIds.includes(order.ordering_branch_id) ||
      args.activeBranchId !== order.ordering_branch_id)
    throw new ClinicalHandoverError("active_branch_scope_required",403);
  const [scope,branch] = await Promise.all([
    tx.userBranchScope.findUnique({
      where: { userId_branchId: { userId: args.actorId, branchId: order.ordering_branch_id } },
      select: { userId: true },
    }),
    tx.branch.findFirst({
      where: { id: order.ordering_branch_id, organizationId: args.organizationId, status: "ACTIVE" },
      select: { id: true },
    }),
  ]);
  if (!scope || !branch) throw new ClinicalHandoverError("active_branch_scope_required",403);
  return { branchId: order.ordering_branch_id, status: order.status };
}
