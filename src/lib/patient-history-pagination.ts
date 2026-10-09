export type PatientHistorySection = "orders" | "results" | "reports" | "finance" | "attachments";
export const PATIENT_HISTORY_PAGE_SIZE = 20;

const SECTIONS = new Set<PatientHistorySection>([
  "orders", "results", "reports", "finance", "attachments",
]);

export function patientHistoryNavigation(
  section: string | undefined,
  page: string | undefined,
  allowedSections: readonly PatientHistorySection[],
) {
  const selected = SECTIONS.has(section as PatientHistorySection)
    && allowedSections.includes(section as PatientHistorySection)
    ? section as PatientHistorySection
    : allowedSections[0] || "orders";
  const validPage = typeof page === "string" && /^[1-9]\d{0,7}$/.test(page)
    ? Number(page)
    : 1;
  return {
    section: selected,
    page: validPage,
    skip: (validPage - 1) * PATIENT_HISTORY_PAGE_SIZE,
    take: PATIENT_HISTORY_PAGE_SIZE + 1,
  };
}

export function historyPageSlice<T>(rows: readonly T[]) {
  return {
    rows: rows.slice(0, PATIENT_HISTORY_PAGE_SIZE),
    hasNext: rows.length > PATIENT_HISTORY_PAGE_SIZE,
  };
}

