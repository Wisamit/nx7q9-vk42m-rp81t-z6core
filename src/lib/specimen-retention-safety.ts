// Retained clinical material is never destroyed merely because its order is old.
// A missing date, approved policy or published final report must fail closed.
export type RetainedSpecimenEvidence = {
  status: string;
  collectedAt: Date | null;
  orderStatus: string;
  orderItemStatuses: string[];
  latestReportStatus: string | null;
  activeTransferCount: number;
  activeSendOutCount: number;
  unresolvedChildCount: number;
  unreleasedResultCount: number;
  activeClinicalHoldCount: number;
};

export function retentionDueAt(collectedAt: Date, days: number): Date {
  if (!Number.isInteger(days) || days < 1 || days > 73000 ||
      !Number.isFinite(collectedAt.getTime())) throw new Error("invalid_retention_interval");
  return new Date(collectedAt.getTime() + days * 24 * 60 * 60 * 1000);
}

export function retainedDisposalBlock(e: RetainedSpecimenEvidence): string | null {
  if (!["RECEIVED", "IN_PROCESS"].includes(e.status)) return "specimen_not_retained";
  if (!e.collectedAt) return "collection_date_not_recorded";
  if (e.orderStatus !== "COMPLETED") return "order_not_completed";
  if (!e.orderItemStatuses.length ||
      e.orderItemStatuses.some(status => status !== "VERIFIED" && status !== "CANCELLED"))
    return "pending_order_tests";
  if (e.latestReportStatus !== "FINAL" && e.latestReportStatus !== "AMENDED")
    return "released_final_report_required";
  if (e.activeTransferCount) return "active_transfer";
  if (e.activeSendOutCount) return "active_sendout";
  if (e.unresolvedChildCount) return "child_specimens_present";
  if (e.unreleasedResultCount) return "unreleased_results";
  if (e.activeClinicalHoldCount) return "active_quality_hold";
  return null;
}

export function independentAuthorization(requesterId: string, approverId: string, executorId?: string) {
  return requesterId !== approverId && (!executorId || approverId !== executorId);
}
