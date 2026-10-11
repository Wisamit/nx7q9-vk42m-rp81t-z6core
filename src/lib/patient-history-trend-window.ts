import { historyPageSlice } from "./patient-history-pagination.ts";

export const EXTENDED_TREND_REPORT_LIMIT = 250;

/**
 * Longitudinal charts are opt-in for wider windows: routine history remains
 * a bounded 20-report page. The expanded window is available only on page 1
 * of the authorized results section, never for an unauthorized user.
 */
export function allowExtendedTrend(
  requested: string | undefined,
  section: string,
  page: number,
  canViewReports: boolean,
): boolean {
  return requested === "extended" && section === "results" &&
    page === 1 && canViewReports;
}

export function clinicalTrendWindow<T>(
  orderedReports: readonly T[],
  expanded: boolean,
) {
  const page = historyPageSlice(orderedReports);
  return {
    page,
    chartEvidence: expanded
      ? orderedReports.slice(0, EXTENDED_TREND_REPORT_LIMIT)
      : page.rows,
    scannedReports: expanded
      ? Math.min(orderedReports.length, EXTENDED_TREND_REPORT_LIMIT)
      : page.rows.length,
    truncated: expanded && orderedReports.length > EXTENDED_TREND_REPORT_LIMIT,
  };
}
