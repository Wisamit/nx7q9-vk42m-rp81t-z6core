# Stage 64 — Independent Policy Review Queue: Full-Batch and History Gate

## Objective
Close the gap between metadata-only discovery and the tenant/branch/department/full-batch authorization previously enforced only when opening or recording a review. The independent review queue must not advertise inaccessible or integrity-damaged staged proposals.

## Implemented
- `src/lib/catalog-policy-review-queue-guard.ts`: only a candidate matching the **current** intact Stage 63 audit revision chain (every actor included) may be advertised. Reject rogue newer events, missing/superseded revisions, broken digests, unauthorized author and overflow. Never return proposal data to queue callers.
- `src/app/api/catalog/imports/policy-review-queue/route.ts`: for each otherwise eligible candidate, load up to 1,001 revisions within the existing locked `RepeatableRead` transaction; verify complete chain, then run Stage 61 `validatePolicyReviewBatchScope` against **every one of the staged rows** and current live six-class catalog masters before returning an entry. Preserve original-session and live role/branch/department intersection, independent reviewers, existing decision separation, strict 30-entry output cap, 100-event discovery cap and private/no-store headers. Failed candidates are omitted without leaking why or any clinical/financial values. Detail GET/POST still recheck everything at the point of use.
- `tests/stage-64-policy-review-queue-gate.test.ts`: full history, rogue event, duplication, wrong source, branch and malformed identity; source-level queue enforcement checks.
- `tests/stage-64-policy-review-queue-mariadb.integration.test.ts`: two SQL connections with a real staged lab test, original/rogue audit authors, live department relocation, foreign tenant and no staged application.
- `.github/workflows/ci.yml`: additional dedicated Stage 64 MariaDB test, all earlier regression tests preserved.

## Safety and boundaries
- The queue still returns **metadata only** (batch ID, draft event ID, revision, timestamp and permitted review domains), not proposal contents, raw AuditEvent JSON, patient data, live result values or prices.
- The queue is bounded; its existing 100-audit-event candidate discovery horizon is not a historical pagination or exhaustive full-workload listing feature. A candidate passing queue checks is **not** a guaranteed future right to review, since role grants or source data can change; detail preflight and POST independently revalidate under the lock.
- Scope and audit-chain verification are structural checks, **not clinical or financial authorization**. The draft remains `UNAPPROVED_DRAFT` and comments remain `PROCEDURAL_REVIEW_ONLY`; `approved=false`, `signingEnabled=false`, `activated=false`, `liveWrites=false`.
- No schema migrations, source master writes, patient history edits, financial publication, final review signing or report amendment.
- Legally valid signatory appointments, MFA reauthentication and effective-dated live application remain blocked pending owner/governance decisions. Full clinical, operational, device and billing UAT is deferred until the complete LIS is ready; Hostinger deployment requires confirmed merged-main CI and owner release acknowledgement.
