/**
 * Read-only report discovery contract. Every user-supplied filter is bound as
 * a parameter; the only interpolated SQL text is a constant predicate or the
 * number of placeholders for server-authorized branch IDs.
 *
 * A PRINT/RECORDED audit event documents an attempt to initiate browser
 * printing. It is NOT evidence that physical paper was produced.
 */
export type ReportQueueStatus = "ALL" | "PARTIAL" | "FINAL" | "AMENDED" | "RETRACTED";
export type ReportQueuePrint = "ALL" | "RECORDED" | "NO_RECORD";
export type ReportQueueFilters = {
  page: number;
  branchId: string;
  status: ReportQueueStatus;
  print: ReportQueuePrint;
  accession: string;
  from: string;
  to: string;
};
export type ReportQueueQuery = {
  sql: string;
  params: Array<string | number>;
};

const STATUSES = new Set(["ALL","PARTIAL","FINAL","AMENDED","RETRACTED"]);
const PRINT_OPTIONS = new Set(["ALL","RECORDED","NO_RECORD"]);
export const REPORT_QUEUE_PAGE_SIZE = 50;
const MAX_REPORT_QUEUE_PAGE = 100_000;

function single(value: string | string[] | undefined) {
  return value === undefined || typeof value === "string" ? value : null;
}
function validUtcDay(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const day = new Date(value + "T00:00:00.000Z");
  return Number.isFinite(day.valueOf()) && day.toISOString().slice(0, 10) === value;
}
function nextUtcDay(value: string) {
  const date = new Date(value + "T00:00:00.000Z");
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10) + " 00:00:00.000";
}
export function parseReportQueueFilters(
  query: Record<string, string | string[] | undefined>,
  authorizedBranches: readonly string[],
): { ok: true; value: ReportQueueFilters } | { ok: false; error: string } {
  const parsed = ["page","branchId","status","print","accession","from","to"]
    .map(key => single(query[key]));
  if (parsed.some(value => value === null)) return { ok: false, error: "duplicate_filter_parameter" };
  const [rawPage, branchId = "", rawStatus = "ALL", rawPrint = "ALL",
    rawAccession = "", from = "", to = ""] = parsed as string[];
  if (rawPage && !/^[1-9]\d{0,7}$/.test(rawPage))
    return { ok: false, error: "invalid_page" };
  const page = Math.min(Number(rawPage || "1"), MAX_REPORT_QUEUE_PAGE);
  if (branchId && !authorizedBranches.includes(branchId))
    return { ok: false, error: "branch_forbidden" };
  if (!STATUSES.has(rawStatus) || !PRINT_OPTIONS.has(rawPrint))
    return { ok: false, error: "invalid_report_filter" };
  const accession = rawAccession.trim();
  if (accession.length > 50 || /[\x00-\x1F\x7F]/.test(accession))
    return { ok: false, error: "invalid_accession" };
  if ((from && !validUtcDay(from)) || (to && !validUtcDay(to)) ||
      (from && to && from > to))
    return { ok: false, error: "invalid_date_range" };
  return { ok: true, value: {
    page, branchId, status: rawStatus as ReportQueueStatus,
    print: rawPrint as ReportQueuePrint, accession, from, to,
  }};
}

export function buildReportQueueQueries(args: {
  organizationId: string;
  authorizedBranchIds: readonly string[];
  filters: ReportQueueFilters;
}): { count: ReportQueueQuery; ids: ReportQueueQuery } {
  const branches = [...new Set(args.authorizedBranchIds)];
  if (!branches.length) throw new Error("REPORT_QUEUE_NO_AUTHORIZED_BRANCHES");
  if (args.filters.branchId && !branches.includes(args.filters.branchId))
    throw new Error("REPORT_QUEUE_BRANCH_FORBIDDEN");

  const where: string[] = [
    "r.organization_id = ?",
    "o.organization_id = ?",
    "o.ordering_branch_id IN (" + branches.map(() => "?").join(",") + ")",
  ];
  const params: Array<string | number> = [
    args.organizationId, args.organizationId, ...branches,
  ];
  const f = args.filters;
  if (f.branchId) {
    where.push("o.ordering_branch_id = ?");
    params.push(f.branchId);
  }
  if (f.status !== "ALL") {
    where.push("v.status = ?");
    params.push(f.status);
  }
  if (f.accession) {
    where.push("o.accession_number = ?");
    params.push(f.accession);
  }
  if (f.from) {
    where.push("v.issued_at >= ?");
    params.push(f.from + " 00:00:00.000");
  }
  if (f.to) {
    where.push("v.issued_at < ?");
    params.push(nextUtcDay(f.to));
  }
  if (f.print === "NO_RECORD") {
    // Retracted current versions must never appear as outstanding print work.
    where.push("v.status <> 'RETRACTED'");
  }
  if (f.print !== "ALL") {
    const hasPrintEvidence = "EXISTS (SELECT 1 FROM report_delivery_events d " +
      "WHERE d.report_version_id = v.id AND d.channel = 'PRINT' " +
      "AND d.status = 'RECORDED')";
    where.push(f.print === "RECORDED" ? hasPrintEvidence : "NOT " + hasPrintEvidence);
  }
  // Do not accept a historical version's printing evidence as evidence for
  // the latest amended/reissued version of the same report.
  const tables = " FROM diagnostic_reports r " +
    "INNER JOIN orders o ON o.id = r.order_id " +
    "INNER JOIN diagnostic_report_versions v " +
    "ON v.report_id = r.id AND v.version = r.current_version ";
  const predicate = " WHERE " + where.join(" AND ");
  return {
    count: {sql: "SELECT COUNT(*) AS total" + tables + predicate, params: [...params]},
    ids: {sql: "SELECT r.id AS reportId, v.id AS versionId" + tables + predicate +
      " ORDER BY v.issued_at DESC, v.id DESC LIMIT ? OFFSET ?",
      params: [...params, REPORT_QUEUE_PAGE_SIZE, (f.page - 1) * REPORT_QUEUE_PAGE_SIZE]},
  };
}

export function reportQueueHref(
  filters: ReportQueueFilters,
  page: number,
) {
  const query = new URLSearchParams();
  if (filters.branchId) query.set("branchId", filters.branchId);
  if (filters.status !== "ALL") query.set("status", filters.status);
  if (filters.print !== "ALL") query.set("print", filters.print);
  if (filters.accession) query.set("accession", filters.accession);
  if (filters.from) query.set("from", filters.from);
  if (filters.to) query.set("to", filters.to);
  query.set("page", String(page));
  return "/reports?" + query.toString();
}

/** An immutable report snapshot, never a mutable central patient record. */
export function reportQueuePatientIdentity(snapshot: unknown, locale: "ar" | "en") {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot))
    return { patientNumber: "—", patientName: "—" };
  const identity = (snapshot as Record<string, unknown>).patient;
  if (!identity || typeof identity !== "object" || Array.isArray(identity))
    return { patientNumber: "—", patientName: "—" };
  const record = identity as Record<string, unknown>;
  const field = (key: string) => {
    const value = record[key];
    return typeof value === "string" && value.trim() ? value.trim() : null;
  };
  return {
    patientNumber: field("patientNumber") || "—",
    patientName: (locale === "ar" ? field("fullNameAr") : null) ||
      field("fullNameEn") || "—",
  };
}
