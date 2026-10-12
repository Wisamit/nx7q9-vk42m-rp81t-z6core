# Stage 95 — Controlled Legacy/Reference Master Configuration Export

## Baseline and verified gap
- Base main: `108db95e48d2523883c096c31aec24b39ea5d407`; owner-confirmed successful Hostinger deployment. Main CI #1133 SUCCESS.
- Master Scope §§87–88 require safe controlled configuration import/export and progressive legacy migration. Stages 82–84 already implement guarded CSV *imports* for referrers, sources, organisms, antibiotics, clients, and clinical comment templates. Current export only covers the clinical catalog and pricing/reference ranges, not these six classes.
- This stage creates a read-only *export complement* to the existing import path. It neither recreates the old import functionality nor imports live patient/financial histories.

## Delivered workflow
1. `/catalog/legacy-master-data` now offers governed master-data export for one of six classes, alongside the existing preview-and-confirm import flow.
2. `GET /api/legacy/master-data-export?kind=...` requires a real staff session, `catalog.manage`, and the relevant narrow permission: `referrers.manage`, `sources.manage`, `microbiology.manage`, `clients.manage`, or `result_comments.manage`.
3. Session branch scope is checked; the active branch and actual `user_branch_scopes` row are revalidated inside a consistent `RepeatableRead` transaction with an active-organization row lock. All data is selected by `organization_id`. No cross-tenant request-controlled organization/branch IDs are accepted.
4. Only **ACTIVE** source records are transferable: deactivated records are not exported and cannot be accidentally reactivated through import. Each type has a strict allowlisted projection, with only legitimate contact fields for referrers/clients and only governed clinical template text for comment templates.
5. Each CSV chunk contains **at most 200 records**, with exact Stage 82–84 import column headers, RFC4180 quoting and UTF-8 text. Every generated non-empty CSV is re-parsed through the *current* legacy importer to verify that the output is actually readable and no silent code/name changes occurred. Unsafe spreadsheet-formula cells, whitespace rewriting, malformed target codes, or unportable rows cause explicit failures rather than silent mutation.
6. Each snapshot can contain at most 2,000 rows and 4 MB serialized output. Exceeding either fails with HTTP 413 **without truncation**. Data is not split across inconsistent HTTP requests within one delivered archive.
7. The JSON evidence includes org/kind/date, a clear snapshot consistency statement, CSV chunks with per-part SHA-256, source UUID/code/status evidence, and an overall SHA-256 over exact chunk digests + provenance. The browser can save both the full audit JSON and individual CSV chunks. No automatic import, activation, billing or patient/clinical action occurs.
8. Export itself creates an `audit_events` record including actor, active branch, kind, counts, hash, contact-data warning, and the unchanged source scope.
9. Re-import is explicitly **create new masters only**, reviewed via the existing legacy importer. Clinical comment templates always enter the target as **INACTIVE** pending separate approval. Export cannot restore referrer/client links, pricing contracts, balances, patient history, external credentials, clinical approval lineage or application DB backups. Those remain separate governed tasks.

## Automated acceptance
- Unit tests: all six export kinds, invalid identifiers, deterministic digest, chunking and overflow, exact round-trip through the existing CSV importer (including quoted/multiline text), formula protection and source authorization/audit guards.
- MariaDB two connections: tenant visibility across six master classes, repeated-read coherent snapshot amid concurrent changes, audit evidence, zero template history/status mutations.
- CI exact SHA: Prisma migrate/status/generate, safety tests, Stage 95 MariaDB test and all earlier suites, TypeScript, ESLint, Arabic/English i18n and RTL guard, Next.js production build. After feature CI green, merge and independently verify main CI on merge SHA.

## Deployment / exclusions
- **No Prisma migration**, database alteration or new secrets. Existing audited `audit_events` storage reused. Production backup remains routine best practice.
- User performs Hostinger deployment only after merged-main CI success and then confirms version.
- No unapproved financial policy, clinical template activation, table-per-test, shared patient records, or new external provider configuration.
- Physical and clinical UAT remains deferred per agreed master plan, not marked completed by automated integration results.
- Existing Draft PR #128 (Analyzer Bridge) and superseded Draft PR #209 remain unmerged and untouched.
