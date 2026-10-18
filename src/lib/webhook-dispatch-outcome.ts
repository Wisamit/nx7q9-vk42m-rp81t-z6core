/**
 * Validate the complete per-delivery batch outcome before displaying success.
 * A successful HTTP response for a dispatch run is NOT proof that any
 * receiving service accepted or acknowledged a diagnostic report.
 */
export type WebhookDispatchOutcome =
  | { kind: "invalid" }
  | {
      kind: "empty" | "http_accepted" | "partial";
      attempted: number;
      httpAccepted: number;
      failed: number;
      deadLetter: number;
      errors: number;
      skipped: number;
    };

const statuses = new Set([
  "DELIVERED", "FAILED", "DEAD_LETTER",
  "DISPATCH_ERROR", "SKIPPED_CONCURRENT_CLAIM",
]);

export function summarizeWebhookDispatch(value: unknown): WebhookDispatchOutcome {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { kind: "invalid" };
  const response = value as Record<string, unknown>;
  if (response.status !== "ok" || !Number.isSafeInteger(response.attempted) ||
    (response.attempted as number) < 0 || (response.attempted as number) > 20 ||
    !Array.isArray(response.results) || response.results.length !== response.attempted)
    return { kind: "invalid" };

  const counts = {
    attempted: response.attempted as number,
    httpAccepted: 0,
    failed: 0,
    deadLetter: 0,
    errors: 0,
    skipped: 0,
  };
  const identities = new Set<string>();
  for (const item of response.results) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return { kind: "invalid" };
    const result = item as Record<string, unknown>;
    if (typeof result.id !== "string" || result.id.trim().length === 0 ||
      identities.has(result.id) || typeof result.status !== "string" ||
      !statuses.has(result.status)) return { kind: "invalid" };
    identities.add(result.id);
    if ("attemptCount" in result && (!Number.isSafeInteger(result.attemptCount) ||
      (result.attemptCount as number) < 0)) return { kind: "invalid" };
    switch (result.status) {
      case "DELIVERED": counts.httpAccepted++; break;
      case "FAILED": counts.failed++; break;
      case "DEAD_LETTER": counts.deadLetter++; break;
      case "DISPATCH_ERROR": counts.errors++; break;
      case "SKIPPED_CONCURRENT_CLAIM": counts.skipped++; break;
    }
  }
  const kind = counts.attempted === 0 ? "empty" :
    counts.httpAccepted === counts.attempted ? "http_accepted" : "partial";
  return { kind, ...counts };
}
