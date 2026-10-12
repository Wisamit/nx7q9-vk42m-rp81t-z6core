export type HomeSpecimenEvidence = {
  id: string;
  status: string;
  barcode: string;
  parentRelationType: string | null;
  collectionAttempts: Array<{
    outcome: string;
    homeCollectionVisitId: string | null;
    collectionLocationType: string;
    collectorUserId: string;
  }>;
  receptionAssessments: Array<{ branchId: string }>;
};
export type HomeFinancialEvidence = {
  status: string;
  currency: string;
  total: string;
  paidAmount: string;
  balanceAmount: string;
};
export type HomeVisitEvidence = {
  id: string;
  orderId: string | null;
  branchId: string;
  assignedCollectorUserId: string | null;
  status: string;
};

export function homeCollectionStartError(
  visit: HomeVisitEvidence,
  specimenCount: number,
  invoices: HomeFinancialEvidence[],
): string | null {
  if (!visit.orderId) return "home_order_link_required";
  if (!visit.assignedCollectorUserId) return "home_collector_required";
  if (specimenCount < 1) return "home_specimens_required";
  if (!invoices.some(invoice =>
    ["ISSUED","PARTIALLY_PAID","PAID"].includes(invoice.status) &&
    invoice.currency.length === 3 &&
    Number.isFinite(Number(invoice.total)))) {
    return "home_issued_invoice_required";
  }
  return null;
}

export function homeCollectionCustodyError(
  visit: HomeVisitEvidence,
  nextStatus: string,
  specimens: HomeSpecimenEvidence[],
  invoices: HomeFinancialEvidence[],
): string | null {
  if (!visit.orderId) return "home_order_link_required";
  if (!visit.assignedCollectorUserId) return "home_collector_required";
  if (!specimens.length) return "home_specimens_required";
  const physical = specimens.filter(s => s.parentRelationType !== "ALIQUOT" &&
    s.status !== "COLLECTION_FAILED");
  if (!physical.length) return "home_specimens_required";
  if (!invoices.some(invoice => ["ISSUED","PARTIALLY_PAID","PAID"].includes(invoice.status) &&
    invoice.currency.length === 3 && Number.isFinite(Number(invoice.total)))) {
    return "home_issued_invoice_required";
  }
  for (const specimen of physical) {
    const collectedForVisit = specimen.collectionAttempts.some(attempt =>
      attempt.outcome === "SUCCESS" &&
      attempt.collectionLocationType === "HOME" &&
      attempt.homeCollectionVisitId === visit.id &&
      attempt.collectorUserId === visit.assignedCollectorUserId);
    if (!collectedForVisit) return "home_specimen_collection_evidence_missing";
    if (nextStatus === "COLLECTED") {
      if (!["COLLECTED","RECEIVED","IN_PROCESS"].includes(specimen.status))
        return "home_specimen_not_collected";
    } else if (nextStatus === "DELIVERED") {
      if (!["RECEIVED","IN_PROCESS"].includes(specimen.status) ||
        !specimen.receptionAssessments.some(assessment => assessment.branchId === visit.branchId))
        return "home_specimen_reception_evidence_missing";
    }
  }
  return null;
}

export function homeOrderMatch(input: {
  orderOrganizationId: string;
  visitOrganizationId: string;
  orderPatientId: string;
  visitPatientId: string;
  orderingBranchId: string;
  visitBranchId: string;
  orderStatus: string;
  visitStatus: string;
  hasSpecimens: boolean;
  specimensAllPlanned: boolean;
  hasOrderItems: boolean;
  alreadyLinked: boolean;
}): string | null {
  if (input.orderOrganizationId !== input.visitOrganizationId ||
      input.orderPatientId !== input.visitPatientId ||
      input.orderingBranchId !== input.visitBranchId)
    return "home_order_patient_branch_mismatch";
  if (input.orderStatus !== "REGISTERED")
    return "home_order_not_active";
  if (!["SCHEDULED","ASSIGNED"].includes(input.visitStatus))
    return "home_visit_too_advanced_to_link";
  if (!input.hasSpecimens || !input.specimensAllPlanned || !input.hasOrderItems)
    return "home_order_specimens_not_ready";
  if (input.alreadyLinked) return "home_order_already_linked_elsewhere";
  return null;
}
