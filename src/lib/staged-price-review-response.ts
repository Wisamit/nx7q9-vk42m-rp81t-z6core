export type StagedPriceReviewCandidate = {
  priceListCode: string;
  testCode: string;
  unitPrice: string;
  effectiveFrom: string;
  effectiveTo: string;
};

export type StagedPriceReviewRow = {
  rowNumber: number;
  rowStatus: string;
  candidate: StagedPriceReviewCandidate;
  currency: string | null;
  disposition: "BLOCKED" | "READY_FOR_GOVERNANCE";
  issues: string[];
};

export type StagedPriceReviewPage = {
  rows: StagedPriceReviewRow[];
  nextCursor: number | null;
  hasMore: boolean;
};

const redactionIssues = new Set([
  "ROW_ALREADY_PROCESSED",
  "STAGED_ROW_HAS_ERRORS",
  "PRICE_LIST_SCOPE_UNRESOLVED",
  "TEST_SCOPE_UNRESOLVED",
]);
const candidateFields = [
  "priceListCode", "testCode", "unitPrice", "effectiveFrom", "effectiveTo",
] as const;

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export function parseStagedPriceReviewPage(body: unknown, after: number): StagedPriceReviewPage {
  if (!Number.isSafeInteger(after) || after < 0 || !object(body) ||
      body.liveWrites !== false || body.approvalRequired !== true ||
      body.currencyConversion !== false || !Array.isArray(body.rows) ||
      body.rows.length > 100 || typeof body.hasMore !== "boolean") {
    throw new Error("unexpected_read_only_price_review_response");
  }

  let previous = after;
  const rows: StagedPriceReviewRow[] = [];
  for (const value of body.rows) {
    if (!object(value) || !Number.isSafeInteger(value.rowNumber) ||
        (value.rowNumber as number) <= previous ||
        typeof value.rowStatus !== "string" ||
        !["BLOCKED", "READY_FOR_GOVERNANCE"].includes(String(value.disposition)) ||
        !Array.isArray(value.issues) ||
        !value.issues.every((issue: unknown) => typeof issue === "string") ||
        !object(value.candidate) ||
        !candidateFields.every(key => typeof (value.candidate as Record<string, unknown>)[key] === "string") ||
        (value.currency !== null && typeof value.currency !== "string")) {
      throw new Error("unexpected_read_only_price_review_response");
    }

    const row = value as unknown as StagedPriceReviewRow;
    const restricted = row.issues.some(issue => redactionIssues.has(issue));
    if (restricted && (row.disposition !== "BLOCKED" || row.currency !== null ||
        candidateFields.some(key => row.candidate[key] !== ""))) {
      throw new Error("unexpected_read_only_price_review_response");
    }
    previous = row.rowNumber;
    rows.push(row);
  }

  const nextCursor = body.nextCursor;
  if (body.hasMore
    ? (rows.length === 0 || !Number.isSafeInteger(nextCursor) || nextCursor !== previous)
    : nextCursor !== null) {
    throw new Error("unexpected_read_only_price_review_response");
  }
  return { rows, nextCursor: nextCursor as number | null, hasMore: body.hasMore };
}
