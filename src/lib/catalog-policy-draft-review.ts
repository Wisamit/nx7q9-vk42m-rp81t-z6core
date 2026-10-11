import { readPolicyDraftLedgerEntry, type PolicyDraftLedgerEntry } from "./catalog-signatory-policy-draft.ts";

export type PolicyReviewDomain = "CLINICAL" | "FINANCIAL";
export type PolicyReviewDisposition = "NOTED_FOR_DISCUSSION" | "RETURN_FOR_REVISION";
export type PolicyReviewReason =
  | "NO_FURTHER_OBJECTION_TO_DISCUSSION"
  | "CLINICAL_AUTHORITY_UNCLEAR"
  | "FINANCIAL_AUTHORITY_UNCLEAR"
  | "BRANCH_SCOPE_UNCLEAR"
  | "MAKER_CHECKER_INDEPENDENCE_UNCLEAR"
  | "REAUTHENTICATION_UNDEFINED"
  | "VERSIONED_RELEASE_UNDEFINED"
  | "CLINICAL_SAFETY_REVIEW_UNDEFINED";

export function validPolicyReviewDomain(input: unknown): input is PolicyReviewDomain {
  return input === "CLINICAL" || input === "FINANCIAL";
}
export function validPolicyReviewDisposition(input: unknown): input is PolicyReviewDisposition {
  return input === "NOTED_FOR_DISCUSSION" || input === "RETURN_FOR_REVISION";
}
export function validPolicyReviewReason(
  domain: PolicyReviewDomain, disposition: PolicyReviewDisposition, reason: unknown,
) {
  if (disposition === "NOTED_FOR_DISCUSSION")
    return reason === "NO_FURTHER_OBJECTION_TO_DISCUSSION";
  return reason === "BRANCH_SCOPE_UNCLEAR" ||
    reason === "MAKER_CHECKER_INDEPENDENCE_UNCLEAR" ||
    reason === "REAUTHENTICATION_UNDEFINED" ||
    reason === "VERSIONED_RELEASE_UNDEFINED" ||
    (domain === "CLINICAL" &&
      (reason === "CLINICAL_AUTHORITY_UNCLEAR" ||
        reason === "CLINICAL_SAFETY_REVIEW_UNDEFINED")) ||
    (domain === "FINANCIAL" && reason === "FINANCIAL_AUTHORITY_UNCLEAR");
}
export function domainReviewPermissions(domain: PolicyReviewDomain, current: ReadonlySet<string>) {
  return current.has("catalog.manage") &&
    current.has(domain === "CLINICAL" ? "catalog.reference_ranges.manage" : "pricing.manage");
}
export type PolicyReviewRecord = {
  draftEventId: string; revision: number; proposalDigest: string;
  domain: PolicyReviewDomain; disposition: PolicyReviewDisposition;
  reasonCode: PolicyReviewReason;
  state: "PROCEDURAL_REVIEW_ONLY"; reviewOnly: true; approved: false;
  signingEnabled: false; activated: false; liveWrites: false;
};
export function parsePolicyReviewRecord(value: unknown, context: {
  draftEventId: string; draft: PolicyDraftLedgerEntry;
}): PolicyReviewRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const obj = value as Record<string, unknown>;
  const domain = obj.domain, disposition = obj.disposition, reasonCode = obj.reasonCode;
  if (!validPolicyReviewDomain(domain) || !validPolicyReviewDisposition(disposition) ||
      !validPolicyReviewReason(domain, disposition, reasonCode) ||
      obj.draftEventId !== context.draftEventId ||
      obj.revision !== context.draft.revision ||
      obj.proposalDigest !== context.draft.proposalDigest ||
      obj.state !== "PROCEDURAL_REVIEW_ONLY" || obj.reviewOnly !== true ||
      obj.approved !== false || obj.signingEnabled !== false ||
      obj.activated !== false || obj.liveWrites !== false) return null;
  return {
    draftEventId: context.draftEventId, revision: context.draft.revision,
    proposalDigest: context.draft.proposalDigest,
    domain, disposition, reasonCode: reasonCode as PolicyReviewReason,
    state: "PROCEDURAL_REVIEW_ONLY", reviewOnly: true, approved: false,
    signingEnabled: false, activated: false, liveWrites: false,
  };
}
export function policyDraftFromHistory(
  value: unknown, context: {
    organizationId: string; batchId: string; branchId: string; sourceChecksum: string;
  },
) {
  return readPolicyDraftLedgerEntry(value, context);
}
export function nextPolicyReviewRecord(input: {
  draftEventId: string; draft: PolicyDraftLedgerEntry;
  domain: PolicyReviewDomain; disposition: PolicyReviewDisposition;
  reasonCode: PolicyReviewReason;
}): PolicyReviewRecord {
  if (!validPolicyReviewReason(input.domain, input.disposition, input.reasonCode))
    throw new Error("policy_review_reason_invalid");
  return {
    draftEventId: input.draftEventId, revision: input.draft.revision,
    proposalDigest: input.draft.proposalDigest,
    domain: input.domain, disposition: input.disposition, reasonCode: input.reasonCode,
    state: "PROCEDURAL_REVIEW_ONLY", reviewOnly: true, approved: false,
    signingEnabled: false, activated: false, liveWrites: false,
  };
}
