import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  catalogPolicyChoices, policyKeys, validateCatalogPolicyProposal,
  catalogPolicyDraftDigest, createPolicyDraftLedgerEntry,
  readPolicyDraftLedgerEntry, type CatalogPolicyProposal,
} from "../src/lib/catalog-signatory-policy-draft.ts";

const context = {
  organizationId: "08a16165-11e8-4ff4-a1cf-2fe265646ace",
  branchId: "198257a6-b46b-4017-829b-1b8fc008713a",
  batchId: "91d06d7a-68a9-451c-9db7-b9e0258a4c67",
  sourceChecksum: "a".repeat(64),
};
const unresolved = Object.fromEntries(
  policyKeys.map(key => [key, "UNDECIDED"]),
) as CatalogPolicyProposal;

test("Stage 59 policy choices are strictly allowlisted and start unresolved", () => {
  assert.equal(policyKeys.length, 7);
  assert.deepEqual(validateCatalogPolicyProposal(unresolved), unresolved);
  assert.equal(validateCatalogPolicyProposal({ ...unresolved, status: "APPROVED" }), null);
  assert.equal(validateCatalogPolicyProposal({
    ...unresolved, signerAuthentication: "PASSWORD_ONLY",
  }), null);
  assert.equal(validateCatalogPolicyProposal({
    ...unresolved, clinicalAuthority: "SELF_SIGNED",
  }), null);
  const truncated = Object.fromEntries(policyKeys.slice(1).map(k => [k,"UNDECIDED"]));
  assert.equal(validateCatalogPolicyProposal(truncated), null);
  assert.equal(validateCatalogPolicyProposal(null), null);
  assert.equal(validateCatalogPolicyProposal([]), null);
  assert.equal(catalogPolicyChoices.reviewerSeparation.includes(
    "AUTHOR_AND_TWO_DISTINCT_REVIEWERS"), true);
});

test("Stage 59 ledger checks tenant, branch, signed-source context and false-only flags", () => {
  const proposal = {
    ...unresolved,
    clinicalAuthority: "MEDICAL_DIRECTOR",
    financialAuthority: "FINANCE_DIRECTOR",
    reviewerSeparation: "AUTHOR_AND_TWO_DISTINCT_REVIEWERS",
  } as CatalogPolicyProposal;
  const first = createPolicyDraftLedgerEntry(context, proposal, 1);
  assert.deepEqual(readPolicyDraftLedgerEntry(first, context), first);
  assert.match(first.proposalDigest, /^[0-9a-f]{64}$/);
  assert.equal(first.state, "UNAPPROVED_DRAFT");
  assert.equal(first.approved, false);
  assert.equal(first.signingEnabled, false);
  assert.equal(first.activated, false);
  assert.equal(first.liveWrites, false);
  assert.equal(readPolicyDraftLedgerEntry(
    first, { ...context, organizationId: "unrelated-tenant" }), null);
  assert.equal(readPolicyDraftLedgerEntry(
    first, { ...context, branchId: "wrong-branch" }), null);
  assert.equal(readPolicyDraftLedgerEntry(
    first, { ...context, sourceChecksum: "b".repeat(64) }), null);
  assert.equal(readPolicyDraftLedgerEntry({ ...first, approved: true }, context), null);
  assert.equal(readPolicyDraftLedgerEntry({ ...first, signingEnabled: true }, context), null);
  assert.equal(readPolicyDraftLedgerEntry({ ...first, activated: true }, context), null);
  assert.equal(readPolicyDraftLedgerEntry({ ...first, liveWrites: true }, context), null);
  assert.equal(readPolicyDraftLedgerEntry({
    ...first, proposal: { ...first.proposal, branchDelegation: "BRANCH_SPECIFIC" },
  }, context), null);
  assert.equal(readPolicyDraftLedgerEntry({ ...first, revision: 0 }, context), null);
  assert.equal(readPolicyDraftLedgerEntry({
    ...first, proposalDigest: "not-the-integrity-digest",
  }, context), null);
  assert.equal(catalogPolicyDraftDigest({ ...context, proposal }),
    catalogPolicyDraftDigest({ ...context, proposal: { ...proposal } }));
  assert.notEqual(catalogPolicyDraftDigest({ ...context, proposal }),
    catalogPolicyDraftDigest({ ...context, proposal: {
      ...proposal, financialAuthority: "DESIGNATED_FINANCIAL_LEAD",
    } }));
  assert.throws(() => createPolicyDraftLedgerEntry(context, proposal, 1001),
    /revision_limit/);
});

test("Stage 59 author-only draft save uses full live batch gate and append-only AuditEvent", () => {
  const route = readFileSync("src/app/api/catalog/imports/[id]/bundle-drift/route.ts","utf8");
  const ui = readFileSync("src/components/catalog-policy-draft-editor.tsx","utf8");
  const host = readFileSync("src/components/catalog-governance-readiness.tsx","utf8");
  assert.match(route, /query\.get\("policyDraft"\) !== "1"/);
  assert.match(route, /readLength > 2048/);
  assert.match(route, /sec-fetch-site/);
  assert.match(route, /validateCatalogPolicyProposal\(body\?\.proposal\)/);
  assert.match(route, /expectedRevision,proposal/);
  assert.match(route, /inspectBundleDrift\(request, context, null, null, false, true, \{/);
  assert.match(route, /createdByUserId: session\.user\.id/);
  assert.match(route, /reconciliation_live_master_scope_changed/);
  assert.match(route, /governance\s*\?\s*staged\s*:\s*staged\.filter/);
  assert.match(route, /organizationId, branchId: liveScope\.branchId/);
  assert.match(route, /action: "CATALOG_BUNDLE_SIGNATORY_POLICY_DRAFT_RECORDED"/);
  assert.match(route, /policy_draft_history_corrupt/);
  assert.match(route, /policy_draft_revision_conflict/);
  assert.match(route, /oldPolicy\?\.proposalDigest === next\.proposalDigest/);
  assert.match(route, /isolationLevel: "RepeatableRead"/);
  assert.doesNotMatch(route, /tx\.(?:labTest|priceList|priceListItem|referenceInterval|catalogImportBatch|catalogImportRow)\.(?:create|update|upsert|delete)/);
  assert.match(ui, /Nonbinding signature-policy proposal/);
  assert.match(ui, /مسودة غير ملزمة/);
  assert.match(ui, /"UNDECIDED"/);
  assert.match(ui, /expectedRevision: savedDraft\?\.revision \|\| 0/);
  assert.match(ui, /policyDraft=1/);
  assert.match(ui, /activated !== false/);
  assert.match(host, /CatalogPolicyDraftEditor/);
});
