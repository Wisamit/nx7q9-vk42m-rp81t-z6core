# Stage 85 — Clinical Comment Template Approval and Concurrency Safety

## Baseline / Scope
- Stage 84 production SHA `872f76ec9d4c0c0f5f5c7ab55beedbf858d643e0`, main CI #1073 SUCCESS; owner confirms Hostinger deployment.
- Master Scope §37 reusable component/test/order/report comments, §38 clinical validation, §63 branch RBAC, §64 clinical approval and §80 immutable historical results. Stage 84 imported old comments as INACTIVE but existing template PATCH accepted unreviewed reactivation with only `result_comments.manage` and no separate clinical reviewer, reason, text attestation or concurrency claims.

## Delivered
- New comments created through `/api/clinical-rules/comments` are also INACTIVE by default, no implicit clinical approval.
- ACTIVATION requires both `result_comments.manage` and `clinical_rules.approve`, an ACTIVE branch grant in the same organization, an explicit bilingual-text approval token and a meaningful 10–1000-character clinical rationale. Retirement needs `result_comments.manage`, active branch and reason.
- Reviewed SHA-256 digest covers template ID, organization, code, scope, test/component IDs, names/text in **both languages**, current status and updatedAt revision. The dashboard shows both clinical text languages before review; server compares the current locked row, not client claims. Digest is a stale-review token, **not** an authentication credential.
- Activation requires trustworthy creation provenance from the existing `LEGACY_MASTER_RECORD_CREATED` or `RESULT_COMMENT_TEMPLATE_CREATED` audit events, denies self-approval, and requires currently ACTIVE correctly-tenanted test and component. Missing creation evidence blocks activation instead of guessing an author.
- Lock tenant organization then template row `FOR UPDATE` in a Serializable transaction, lock active test/component targets, enforce status + updatedAt `updateMany` compare-and-swap, update state and approval/retirement audit atomically. Concurrent operators cannot both activate or record competing approval; any failure rolls back. Audit records reviewers, author, exact old/new fingerprints, reason, branch/IP/user agent.
- Deactivation never removes or rewrites historical clinical results, issued report versions or prior approval/audit evidence; reactivation requires new authorized independent clinical review.
- No newly defined clinical content/interpretation policies or automated medical validation implied. User/device/manual UAT remains deferred until entire LIS is built.

## Automated acceptance
- `tests/stage-85-comment-template-approval-safety.test.ts`: fingerprint identity, target, bilingual text and revision drift, denial of self-approval, missing provenance, missing review/invalid targets, API authorization, dual permission, server row locking, strict CAS, UI acknowledgement.
- `tests/stage-85-comment-template-approval-mariadb.integration.test.ts`: real two-connection MariaDB lock contention, tenant isolation, original creator vs independent reviewer, atomic transition and durable provenance audit, duplicate transition rejection, retirement. SQL-level concurrency test supplements source/policy tests; no physical instrument acceptance is claimed.
- Dedicated new CI MariaDB command; existing migrations, safety, all MariaDB integration tests, TypeScript, lint, RTL/i18n and Next.js build unchanged.

## Release boundaries and residual work
- No schema migrations, new secrets or env vars; release changes runtime behavior of manual template creation/reactivation. Existing ACTIVE templates remain untouched; INACTIVE templates lacking creation audit are fail-closed and need explicit provenance remediation, not an unreviewed bypass.
- Prior approved clinical content can be retired without mutating an issued report. Future clinician review/approval policy and signature/second-factor decisions remain organizational/legal acceptance items; do not represent CI as a clinical UAT.
- PR #128 Analyzer Bridge stays OPEN + DRAFT + UNMERGED, unmodified. All Master Scope features remain in scope.
