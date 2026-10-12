# Stage 86 — Independent Clinical Comment Review Queue and Safe Draft Intake

## Baseline and gap
- Stage 85 `main` SHA `5fe9fdb3efba78d0773bcbb301b8a40370adda4a`, main CI #1076 SUCCESS; owner confirms Hostinger deployment.
- Master Scope §§37 (component/test/order/report comments and reusable templates), 38 (validation), 41 (clinical audit), 63 (permissions) and 80 (history). Stage 85 required an independent reviewer with `clinical_rules.approve` and `result_comments.manage`, but the only existing template listing was at `/clinical-rules` gated behind **another** permission `clinical_rules.manage`. Authorized reviewers without management rights therefore could not review/activate imported/created drafts. The old POST also accepted unknown scope by defaulting to organization and could create orphaned/inactive target links.

## Implemented safe operator workflow
- New `/clinical-comments/review` page available with `clinical_rules.approve` **AND** `result_comments.manage` and an ACTIVE branch grant within the same organization; it does not need `clinical_rules.manage`.
- Navigation link uses `permissionsAll` (not an OR permission). A direct URL enforces the same conjunction server-side. No data is queried or shown for unauthenticated/unscoped users; all queries restrict `organizationId`.
- Keyset-paginated 50-item inactive-template queue; total count is tenant-scoped. Full EN and AR clinical wording, names, target/scope, original creator/import audit and prior decision/reason displayed. Each draft shows its blocker: unknown creation provenance, self-approval, inactive/wrong-tenant test/component, or missing required wording. Independent eligible reviewers use Stage 85 fingerprint-bound confirmation and 10–1000-character reason via the existing transactional approval endpoint.
- Strict cursor validation, never interprets cursors as permission; queue never guesses missing creation evidence. Past approval/retirement history remains in immutable `AuditEvent` entries.
- Manual `POST /api/clinical-rules/comments` now rejects implicit scope guesses, incompatible targets, malformed IDs, control characters, over-limit text/names or noncanonical codes instead of truncating/altering clinical interpretation silently.
- The create transaction locks active organization, active authorized branch, and correctly linked ACTIVE test/component in the same organization before inserting an explicitly INACTIVE template and creation audit. Duplicates/stale targets/lock failures roll back as a unit. API responses disable caching. The authoring UI explains independent clinical approval after draft creation and surfaces structured creation errors.

## Automated acceptance
- `tests/stage-86-comment-clinical-review-safety.test.ts`: strict bilingual input and scope validation, all review blocker cases, pagination cursor tampering, server/UI/side-menu permission intersection, tenant isolation, creation target locks and audit.
- `tests/stage-86-comment-clinical-review-mariadb.integration.test.ts`: real MariaDB test with two connections, tenant/target cross-link prevention, live target row lock vs competing deactivation, inactive bilingual draft persistence, author audit, different reviewer eligibility, later target deactivation and scoped cleanup.
- Dedicated MariaDB stage command registered in CI. Existing safety tests, Prisma migration/status/generate, TypeScript, lint, RTL/English checks and Next build continue unchanged.

## Deployment and limits
- No schema migration or new environmental configuration. Existing active templates, results, report revisions, released patient history, invoices and referrer contracts are not rewritten.
- The queue addresses **test/component/organization reusable templates** already modeled; order/report-level interpretive text and versioned clinical comment template revisions remain within full Master Scope for subsequent stages, not silently removed.
- There is no implied automatic approval or safe clinical interpretation of imported language. Clinical/operator/UAT signoff remains outside automated CI, deliberately deferred until full software delivery under the agreed workflow. PR #128 Analyzer Bridge must remain OPEN, DRAFT and unmodified.
