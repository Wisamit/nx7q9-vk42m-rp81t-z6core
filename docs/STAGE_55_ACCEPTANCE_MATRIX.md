# Stage 55 — Audit-Driven Catalog Finding Lifecycle and Stale Evidence Guard

## Confirmed baseline
Stage 54 merge SHA `0a2637715309235975cef1e1830f3bbde2652db6` was explicitly confirmed deployed on Hostinger by the owner. Its independently merged `main` CI #976 completed SUCCESS. Repository remains deliberately PUBLIC. All 88 sections of `02_MASTER_SCOPE.md` remain in force.

## Risk addressed
Stage 53 recorded author triage flags and Stage 54 recorded independent clinical/financial review dispositions, but the original author-facing Stage 52 review UI showed only the last *referral*, not the later decision or whether the referred clinical/financial values had changed. The Stage 53 POST could append another referral with a different reason even when the identical clinical-price observation was already pending or independently decided. A decided historic observation must not masquerade as either a current approval or a new work item without new evidence.

## Implemented safeguards
- `src/lib/catalog-finding-lifecycle.ts` defines deterministic status from the latest signed source/live observation and the corresponding independent audit decision:
  - `UNFLAGGED`: no flag, can refer.
  - `AWAITING_EXPERT`: latest observation flagged, not yet independently reviewed.
  - `EXPERT_CONFIRMED`: latest observation independently confirmed as a *finding* only; not approved or activated.
  - `RETURNED_FOR_CORRECTION`: latest observation returned by expert; no new activation.
  - `STALE_REVIEW_REQUIRED`: clinical or financial source/live observation has changed since latest flag, regardless of old decision. Only a **new, fresh observation** can be referred.
- Existing fully live-scoped, author-only `GET /api/catalog/imports/[id]/bundle-drift` now joins **latest referral per staged row** and **its own separate expert decision** after tenant/branch/department/role re-authorization and source-vs-live comparison inside RepeatableRead. The query sorts by timestamp then audit ID, limits at 1,001 rows and **fails closed** rather than letting a truncated history misrepresent a latest flag. Duplicate or invalid decision events fail closed. The UI receives only status flags, reason codes and non-sensitive field paths; it receives no old/current numerical clinical values or raw price amounts.
- Existing Stage 53 `POST` now refuses to re-flag **the same verified observation** with an alternate reason to evade a pending review or completed decision. Exact duplicate pending observations remain safely idempotent. A materially changed observation requires fresh HMAC and can create a new independent review cycle; prior AuditEvents stay immutable.
- `src/components/catalog-bundle-drift-review.tsx` displays clear bilingual status labels and disables redundant referral buttons. Explicitly distinguishes confirmed *finding* from final clinical or financial approval.

## Acceptance plan
- `tests/stage-55-catalog-finding-lifecycle.test.ts`: proves all five lifecycle states and exact 6-decimal reference-critical / 4-decimal price and currency/date changes, pending-vs-decided resubmission restrictions, current tenant/scope and no master writes.
- `tests/stage-55-catalog-finding-lifecycle-mariadb.integration.test.ts`: live MariaDB with **two independent connections** and actual tenant, branch, source batch, staged row, audit referrals and expert decision. Checks the latest event, old reviewed observation, new master value, stale HMAC, fresh re-referral, cross-tenant isolation and no update from the review itself.
- Full project safety suite, all Stage 1–54 MariaDB regressions, migration/status/generate, TypeScript, ESLint, AR/EN UI consistency and production Next.js build must succeed for the exact feature SHA and then an independent merged `main` SHA.

## Scope and safety limitations
- Stage 55 is a governance **visibility and re-triage gate**. No live master test/price/reference interval changes, no approval to publish signed configuration, no result version/amendment changes, no invoices modified, no author-only sign-off and no new schema migration.
- Any final electronic signatory roles, re-authentication, cryptographic key rotation, conflict resolution of effective-dated entries and *approval to apply* a staged value still require explicit policy decisions and later implementation. A clinical reviewer confirming a **finding** is not a clinical director approving a **new reference interval**.
- Manual/hardware analyzer, barcode/scanner, clinical/finance end-to-end commissioning, security and disaster recovery UAT remain **DEFERRED**, not waived or falsely marked passed.
- Draft Analyzer Bridge PR #128 remains unmerged and untouched. The project remains a multi-branch, centrally identified patient, Arabic/English, historically immutable LIS.
