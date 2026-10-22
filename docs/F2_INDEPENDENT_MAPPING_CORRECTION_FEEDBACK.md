# F2 — Independent mapping correction feedback (review-only)

## Boundary

An author-owned, HMAC-authenticated mapping discussion and exact fresh live
observation do **not** establish source installation provenance, approved
foreign UUID mapping or authority to activate a medical or financial master.

This increment provides a **separate, correction-only POST**, not an approval
endpoint. The existing `GET /api/catalog/imports/:batchId/mapping-inspection`
remains GET-only.

`POST /api/catalog/imports/:batchId/mapping-feedback?rowId=:rowUuid`

Exactly these JSON fields are accepted (synthetic shape, no raw source values):

```json
{
  "expectedFeedbackRevision": 0,
  "expectedAuthorDraftRevision": 1,
  "disposition": "REQUEST_SOURCE_INSTALLATION_EVIDENCE"
}
```

The only dispositions are `REQUEST_SOURCE_INSTALLATION_EVIDENCE` and
`RETURN_MAPPING_TO_AUTHOR`. They are **requests for correction** and cannot
be interpreted as mapping acceptance, clinical policy approval, financial
approval, authenticated source installation identity or application consent.

## Validation and concurrency

- Strict JSON object shape and small bounded UTF-8 body. Same-origin check
  when an Origin is supplied; cross-site fetch requests are denied.
- Reuses the existing independent mapping GET preflight in the **same tenant
  `FOR UPDATE` and `RepeatableRead` transaction**. Thus reviewer
  `userId !== batch.createdByUserId`, original and current permissions,
  live organization, active branch and department grants, category-specific
  CLINICAL/FINANCIAL/both grants for PANEL/PACKAGE, **whole signed v2 source
  stage**, **full author HMAC chain** and **exact current author-side live
  HMAC observation** must all succeed before feedback is appended.
- Source installation provenance is not guessed: it remains
  `sourceInstanceProven: false`. No third-party bundle UUID becomes portable
  or an authoritative local mapping.
- Only the latest **author revision number** from the independent GET is
  acceptable; the actual author digest is recomputed and bound internally,
  never exposed through the browser request. The independent GET also returns
  `feedbackRevision` and the latest matching categorical
  `feedbackDisposition` (or null), after authenticating the full feedback
  HMAC audit history. Only the latest author draft digest is acceptable. An independent
  feedback expected revision acts as a tenant-serialized CAS. Exact retries
  return `INDEPENDENT_MAPPING_FEEDBACK_UNCHANGED` without a second event;
  concurrent changed/stale inputs fail closed.
- Appends solely `CATALOG_BUNDLE_MAPPING_FEEDBACK_RECORDED` on
  `CatalogImportRow` as an audit event. HMAC-SHA256 has its own domain
  separation and binds tenant, branch, batch, staged row, category,
  source checksum, author, reviewer, current live token and linked author
  draft digest. The bounded complete feedback chain must validate before
  adding a revision. Forged, missing, reordered, duplicate, wrong-actor,
  cross-tenant, wrong-key and edited events fail closed. The verified
  revision and HMAC previous-digest chain, **not** database
  `occurredAt DESC, id DESC` order, determine the latest feedback. Legitimate
  events sharing an identical millisecond and sorting in the reverse
  UUID order are accepted; forged ordinal duplicates, missing intermediate
  revisions and digest forks still fail closed. Deletion of the terminal
  audit event cannot be detected from this ledger alone without an external
  immutable anchor, so this is not an externally notarized audit chain.
- Response carries only categorical disposition, revision and
  `reviewOnly:true`, `sourceInstanceProven:false`,
  `mappingApproved:false`, `approved:false`, `signingEnabled:false`,
  `activated:false`, `liveWrites:false`. No source JSON, target IDs,
  clinical intervals, money, auditor IDs, evidence checksum or HMAC leaks.

## Automated evidence

- `tests/f2-mapping-reviewer-feedback.test.ts` validates every ten native
  class, explicit correction-only dispositions, independent reviewer and
  HMAC-authenticated chain, tampering and source-route non-authorization.
- `tests/f2-mapping-reviewer-feedback-mariadb.integration.test.ts`
  exercises two independently connected MariaDB sessions with synthetic
  tenant, author, reviewer, staged row, immutable audit and adversarial edits.
- Existing `tests/f2-mapping-independent-inspection.test.ts` now checks
  the reusable preflight module as well as the GET-only route wrapper.
- CI explicitly runs the new MariaDB test alongside TypeScript, ESLint,
  safety tests, all existing real MariaDB integrations and Next build.

## Remaining external policy and product exit

`BLOCKED_EXTERNAL`: verified original installation/source lineage and
foreign-to-local mapping policy, independently credentialed clinical/finance
signatories with MFA and effective-dated policies. No qualified approval,
clinical range/price publication, signed versioned apply/reversal or
export→approved apply→re-export ten-class parity is implemented here.
`CSV_REVIEW` and `CONFIG_BUNDLE_REVIEW` ordinary commit denial stays.

F2 remains IN_PROGRESS; PR #334 DRAFT/OPEN; no merge/Hostinger deploy/restart
under current HOLD. F7 browser UAT deferred until after F6; F8 NO_GO.
