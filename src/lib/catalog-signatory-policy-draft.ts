import { createHash } from "node:crypto";

import {
  catalogPolicyChoices, policyKeys, type CatalogPolicyProposal,
} from "./catalog-policy-options.ts";
export { catalogPolicyChoices, policyKeys };
export type { CatalogPolicyProposal, CatalogPolicyKey } from "./catalog-policy-options.ts";

export function validateCatalogPolicyProposal(value: unknown): CatalogPolicyProposal | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const obj = value as Record<string, unknown>;
  if (Object.keys(obj).sort().join(",") !== policyKeys.join(",")) return null;
  for (const key of policyKeys) {
    const selection = obj[key];
    if (typeof selection !== "string" ||
      !(catalogPolicyChoices[key] as readonly string[]).includes(selection)) return null;
  }
  return obj as CatalogPolicyProposal;
}

/**
 * Not an electronic signature, approval, attestation, or authorization.
 * A digest detects unintentional policy-draft mismatches, but carries NO
 * signer identity or cryptographic authentication assurance.
 */
export function catalogPolicyDraftDigest(input: {
  organizationId: string; batchId: string; branchId: string;
  sourceChecksum: string; proposal: CatalogPolicyProposal;
}) {
  const selections = policyKeys.map(key => [key, input.proposal[key]]);
  return createHash("sha256").update(JSON.stringify([
    "FAMILY_LAB_CATALOG_POLICY_PROPOSAL_DRAFT_V1",
    input.organizationId, input.batchId, input.branchId,
    input.sourceChecksum, selections,
  ])).digest("hex");
}

export type PolicyDraftLedgerEntry = {
  revision: number; proposal: CatalogPolicyProposal; proposalDigest: string;
  organizationId: string; batchId: string; branchId: string; sourceChecksum: string;
  state: "UNAPPROVED_DRAFT"; reviewOnly: true; approved: false;
  signingEnabled: false; activated: false; liveWrites: false;
};

export function readPolicyDraftLedgerEntry(value: unknown, context: {
  organizationId: string; batchId: string; branchId: string; sourceChecksum: string;
}): PolicyDraftLedgerEntry | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const obj = value as Record<string, unknown>;
  const proposal = validateCatalogPolicyProposal(obj.proposal);
  if (!proposal || !Number.isSafeInteger(obj.revision) ||
      (obj.revision as number) < 1 || (obj.revision as number) > 1000 ||
      obj.organizationId !== context.organizationId ||
      obj.batchId !== context.batchId || obj.branchId !== context.branchId ||
      obj.sourceChecksum !== context.sourceChecksum ||
      obj.state !== "UNAPPROVED_DRAFT" || obj.reviewOnly !== true ||
      obj.approved !== false || obj.signingEnabled !== false ||
      obj.activated !== false || obj.liveWrites !== false) return null;
  const digest = catalogPolicyDraftDigest({ ...context, proposal });
  if (obj.proposalDigest !== digest) return null;
  return {
    ...context, revision: obj.revision as number, proposal,
    proposalDigest: digest, state: "UNAPPROVED_DRAFT", reviewOnly: true,
    approved: false, signingEnabled: false, activated: false, liveWrites: false,
  };
}

export function createPolicyDraftLedgerEntry(context: {
  organizationId: string; batchId: string; branchId: string; sourceChecksum: string;
}, proposal: CatalogPolicyProposal, revision: number): PolicyDraftLedgerEntry {
  if (!Number.isSafeInteger(revision) || revision < 1 || revision > 1000)
    throw new Error("policy_draft_revision_limit");
  return {
    ...context, revision, proposal,
    proposalDigest: catalogPolicyDraftDigest({ ...context, proposal }),
    state: "UNAPPROVED_DRAFT", reviewOnly: true, approved: false,
    signingEnabled: false, activated: false, liveWrites: false,
  };
}
