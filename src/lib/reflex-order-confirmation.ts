/** Pure, fail-closed evidence check for human Reflex-to-order confirmation.
 * This never creates an order, specimen, charge, clinical result or report.
 */
export type ReflexOrderEvidence = {
  sameOrganization: boolean;
  organizationId: string;
  sourcePatientId: string;
  targetPatientId: string;
  sourceOrderingBranchId: string;
  targetOrderingBranchId: string;
  sourceOrderId: string;
  targetOrderId: string;
  targetItemId: string;
  targetTestId: string;
  ruleTargetTestId: string;
  targetItemStatus: string;
  targetOrderStatus: string;
  targetItemCreatedAt: Date;
  reflexDetectedAt: Date;
  invoiceStatus: string;
  invoiceOrderId: string | null;
  invoiceCurrency: string;
  invoiceLineOrderItemId: string | null;
  invoiceLineTotal: string;
  targetItemFinalPrice: string;
  targetItemCurrency: string;
  invoiceLineQuantity: string;
  specimenRequirementConfigured: boolean;
  activeSpecimens: Array<{
    specimenOrganizationId: string;
    specimenOrderId: string;
    specimenTypeId: string | null;
    requiredSpecimenTypeId: string | null;
    specimenStatus: string;
    currentBranchId: string | null;
  }>;
  explicitBillingAcknowledgement: boolean;
};
export type ReflexOrderEvidenceError =
  | "reflex_confirmation_missing_billing_acknowledgement"
  | "reflex_target_order_identity_mismatch"
  | "reflex_target_test_mismatch"
  | "reflex_target_order_invalid_state"
  | "reflex_target_order_predates_recommendation"
  | "reflex_target_invoice_not_issued"
  | "reflex_target_invoice_line_mismatch"
  | "reflex_target_price_currency_mismatch"
  | "reflex_target_specimen_plan_missing";

const money = (input: string): bigint | null => {
  if (!/^(0|[1-9]\d{0,13})(?:\.(\d{1,4}))?$/.test(input)) return null;
  const [whole, fraction = ""] = input.split(".");
  return BigInt(whole) * 10000n + BigInt(fraction.padEnd(4, "0"));
};

export function reflexOrderEvidenceError(e: ReflexOrderEvidence): ReflexOrderEvidenceError | null {
  if (!e.explicitBillingAcknowledgement) return "reflex_confirmation_missing_billing_acknowledgement";
  if (!e.sameOrganization || e.sourcePatientId !== e.targetPatientId
    || e.sourceOrderingBranchId !== e.targetOrderingBranchId)
    return "reflex_target_order_identity_mismatch";
  if (e.targetTestId !== e.ruleTargetTestId)
    return "reflex_target_test_mismatch";
  if (e.targetItemStatus === "CANCELLED" || ["CANCELLED", "DRAFT"].includes(e.targetOrderStatus))
    return "reflex_target_order_invalid_state";
  if (e.targetOrderId !== e.sourceOrderId && e.targetItemCreatedAt.getTime() < e.reflexDetectedAt.getTime())
    return "reflex_target_order_predates_recommendation";
  if (!["ISSUED", "PARTIALLY_PAID", "PAID"].includes(e.invoiceStatus))
    return "reflex_target_invoice_not_issued";
  if (!e.invoiceLineOrderItemId || !e.invoiceOrderId || e.invoiceOrderId !== e.targetOrderId
    || e.invoiceLineOrderItemId !== e.targetItemId || e.invoiceLineQuantity !== "1.000")
    return "reflex_target_invoice_line_mismatch";
  const billed = money(e.invoiceLineTotal), item = money(e.targetItemFinalPrice);
  if (!/^[A-Z]{3}$/.test(e.invoiceCurrency)
    || e.invoiceCurrency !== e.targetItemCurrency
    || billed === null || item === null || billed !== item)
    return "reflex_target_price_currency_mismatch";
  if (e.specimenRequirementConfigured && !e.activeSpecimens.some(s =>
    s.specimenOrganizationId === e.organizationId && s.specimenOrderId === e.targetOrderId
      && s.specimenTypeId === s.requiredSpecimenTypeId
      && ["PLANNED", "COLLECTED", "RECEIVED", "IN_PROCESS"].includes(s.specimenStatus)))
    return "reflex_target_specimen_plan_missing";
  return null;
}
