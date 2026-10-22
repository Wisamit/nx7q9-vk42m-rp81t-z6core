import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  POLICY_DRAFT_HISTORY_LIMIT, verifyPolicyDraftHistory,
} from "../src/lib/catalog-policy-draft-history.ts";
import {
  createPolicyDraftLedgerEntry, policyKeys, type CatalogPolicyProposal,
} from "../src/lib/catalog-signatory-policy-draft.ts";

const scope = {
  organizationId: "11000000-0000-4000-8000-000000000011",
  batchId: "22000000-0000-4000-8000-000000000022",
  branchId: "33000000-0000-4000-8000-000000000033",
  sourceChecksum: "a".repeat(64),
  authorUserId: "44000000-0000-4000-8000-000000000044",
};
const choices = Object.fromEntries(policyKeys.map(key => [key, "UNDECIDED"])) as CatalogPolicyProposal;
const draft = (revision: number) => createPolicyDraftLedgerEntry(scope, choices, revision);
const entry = (revision: number, actorUserId: string | null = scope.authorUserId) => ({
  id: String(revision).padStart(32, "0"), actorUserId, newValues: draft(revision),
});
const verify = (events: { id: string; actorUserId: string | null; newValues: unknown }[]) =>
  verifyPolicyDraftHistory({ ...scope, events });

test("Stage 63: empty and consecutive history preserve latest identity and exact revision", () => {
  assert.deepEqual(verify([]), { latestEventId: null, draft: null, revisionCount: 0 });
  const two = verify([entry(2), entry(1)]);
  assert.equal(two?.latestEventId, entry(2).id);
  assert.equal(two?.revisionCount, 2);
  assert.equal(two?.draft?.revision, 2);
  // Same-millisecond SQL ordering may return the older revision first.
  // Signed author/branch/source and unique contiguous revision remain binding.
  assert.equal(verify([entry(2), entry(1)])?.draft?.proposalDigest, draft(2).proposalDigest);
  assert.equal(verify([entry(1), entry(2)])?.draft?.revision, 2);
  assert.equal(verify([entry(1), entry(2)])?.latestEventId, entry(2).id);
});

test("Stage 63: unknown actors, duplicate revisions, gaps, damaged checksums and source mismatch fail closed", () => {
  const one = entry(1);
  const two = entry(2);
  assert.equal(verify([entry(2)]), null);
  assert.equal(verify([entry(3), entry(1)]), null);
  assert.equal(verify([two, one, one]), null);
  assert.equal(verify([{ ...one, id: two.id }, two]), null);
  assert.equal(verify([{ ...one, actorUserId: "other" }]), null);
  assert.equal(verify([{ ...one, actorUserId: null }]), null);
  assert.equal(verify([{ ...one, newValues: { ...one.newValues, proposalDigest: "0".repeat(64) } }]), null);
  assert.equal(verify([{ ...one, newValues: { ...one.newValues, branchId: scope.batchId } }]), null);
  assert.equal(verify([{ ...one, newValues: { ...one.newValues, sourceChecksum: "f".repeat(64) } }]), null);
  assert.equal(verify([{ ...one, newValues: { ...one.newValues, approved: true } }]), null);
  assert.equal(verify([two, one])?.draft?.approved, false);
  assert.equal(verify([two, one])?.draft?.liveWrites, false);
  assert.equal(verify([two, one])?.draft?.signingEnabled, false);
});

test("Stage 63: bounded 1,000 entries, no silent truncation or 1,001st revision", () => {
  assert.equal(POLICY_DRAFT_HISTORY_LIMIT, 1000);
  const full = Array.from({length: 1000}, (_, i) => entry(1000 - i));
  assert.equal(verify(full)?.revisionCount, 1000);
  assert.equal(verify(full)?.draft?.revision, 1000);
  assert.equal(verify([...full, entry(1)]), null);
});

test("Stage 63: author and independent reviewer both verify entire audit lineage inside tenant lock", () => {
  const author = readFileSync("src/app/api/catalog/imports/[id]/bundle-drift/route.ts", "utf8");
  const reviewer = readFileSync("src/app/api/catalog/imports/[id]/policy-review/route.ts", "utf8");
  for (const source of [author, reviewer]) {
    assert.match(source, /verifyBranchScopedPolicyDraftHistory\(/);
    assert.match(source, /POLICY_DRAFT_HISTORY_LIMIT \+ 1/);
    assert.match(source, /select: \{ id: true, actorUserId: true, branchId: true, newValues: true \}/);
    assert.match(source, /isolationLevel: "RepeatableRead"/);
    assert.match(source, /FOR UPDATE/);
  }
  assert.match(author, /policy_draft_history_corrupt/);
  assert.match(author, /policy_draft_revision_limit/);
  assert.match(reviewer, /policy_review_draft_integrity_error/);
  assert.match(reviewer, /policy_review_stale_revision/);
  assert.doesNotMatch(author + reviewer,
    /tx\.(?:labTest|referenceInterval|priceList|priceListItem|unit)\.(?:create|update|upsert|delete)/);
});
