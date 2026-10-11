# Stage 68 — AuditEvent Composite Index for Independent Policy Review Queue

## Problem
The tenant's `audit_events` table stores clinical, billing, specimen, user and many other actions. The Stage 65–67 independent review queue repeatedly selects the latest scoped unsigned policy draft events and procedural independent-review events, gets their counts to detect drift, and paginates them using `occurredAt DESC, id DESC`. Existing indexes on individual tenant/date, branch/date or entity/type/date do not provide the complete `organizationId, branchId, action, entityType` equality prefix before the keyset.

## Implementation
- `prisma/schema.prisma`: append `@@index([organizationId, branchId, action, entityType, occurredAt, id], map: "audit_events_policy_queue_scan_idx")` on the existing `AuditEvent` model.
- Migration `20261011143000_policy_review_queue_audit_index`: exactly one additive `CREATE INDEX` on the existing `audit_events` table; no data/model rewrites, changes to patient IDs, results, pricing, scopes, timestamps or audit event contents.
- The leftmost index prefix covers both `CATALOG_BUNDLE_SIGNATORY_POLICY_DRAFT_RECORDED` / `CatalogImportBatch` and `CATALOG_BUNDLE_POLICY_DRAFT_REVIEW_RECORDED` / `CatalogPolicyDraft` predicates, and supplies `occurred_at, id` to read the latest audit event, exact count and stable keyset.
- Existing Stage 67 API, 20-minute signed cursors, stale-mark detection, branch-scoped permission revalidation, full 1,000-revision history and 5,000-row live master checks are deliberately **unchanged**. Source and clinical/financial safety behavior does not change.
- `tests/stage-68-policy-queue-audit-index.test.ts`: index shape matches Prisma + SQL; queue security invariants retained; migration contains no destructive SQL.
- `tests/stage-68-policy-queue-audit-index-mariadb.integration.test.ts`: verify index on migrated MariaDB, EXPLAIN with index selection, real separated organization/branch/action/type AuditEvents, deterministic same-millisecond keyset pagination, count integrity, no lost audit history and no clinical master mutations.
- CI retains all earlier tests and adds Stage 68 MariaDB integration gate.

## Operational release notes
- **This stage includes a real schema migration**. On Hostinger, take and verify a database backup, arrange a maintenance window if `audit_events` is large, and use the existing deployment migration command `npx prisma migrate deploy` exactly once for the release. Creation of a secondary index can consume disk and impose metadata locks or write contention depending on the deployed MariaDB version, table size and workload; it is not guaranteed to be zero downtime.
- `npx prisma migrate status` should report no pending migrations after applying. Do not run `prisma db push` as a replacement for the tracked migration. The schema and migration index names must remain identical.
- This change improves available query paths but does not claim a measured production latency reduction without Hostinger production query plans/metrics. MariaDB can still choose another index depending on cardinality and statistics.
- Rollback is handled by the operational rollback plan and DBA-reviewed index removal if necessary; **never** drop or rewrite historical AuditEvents as part of index rollback.

## Unchanged clinical/financial guardrails
No changes to release/amendment workflow, prices, reference intervals, results, QC, specimen traceability or patient identity. Independent policy comments remain `PROCEDURAL_REVIEW_ONLY`; final signing, activation and liveWrites remain disabled. Stage 10 Analyzer Bridge draft PR #128 is unrelated and excluded. Full manual UAT remains deferred pending system completeness and explicit owner safety/authority decisions.
