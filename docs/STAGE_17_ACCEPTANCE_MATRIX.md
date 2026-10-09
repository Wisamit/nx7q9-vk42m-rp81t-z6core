# Stage 17 — Resilience & Scale Workflow Integrity Acceptance

**Starting main:** `2c247f4e31f710cc19208b6132a60ebe06da4614`, CI #866 success; owner confirmed Hostinger deployment.  
**Scope:** Master Scope high availability, data backups/retention, disaster recovery, branch continuity and eventual analyzer/edge integration. No feature has been removed by phasing.

## Reused architecture
Database-backed readiness/liveness, resilient and branch-scoped administration UI, provider-backed backup/restore evidence metadata, DR drill RPO/RTO registration, non-clinical edge event buffer, tenant-scoped session retention preview and controlled purge, retention protection of clinical/audit history, Prisma migrations and MariaDB regression CI.

## This increment

| Concern | Integrity control |
|---|---|
| Branch continuity policy | Lock active `branches` row with `organization_id` + `FOR UPDATE` in serializable transaction before editing mode; forces `offlineClinicalWritesAllowed=false` |
| Edge node registration | Lock same active branch and re-check current non-clinical mode under transaction before creating a node; no stale-mode registration |
| Edge sync | Revalidate active branch, current buffering policy and active node in serializable transaction after obtaining branch→node locks; blocks races against policy disable and competing batches |
| Edge idempotency | Node mutex serializes cross-worker duplicate inserts; existing payload hash remains backward-compatible and stored event type must also match |
| Event boundary | Only four existing non-clinical event classes; JSON object payload required and aggregate payload-byte/batch caps unchanged; no clinical record mutation |
| Retention policy | Organization mutex serializes retention policy changes and purge, including first policy upsert |
| Session purge | Organization mutex, live policy re-read and action/retention/class revalidation happen **inside** one transaction before delete+audit; cannot purge using stale policy snapshot |
| Backup evidence | VERIFIED requires actual restore test date after backup creation, elapsed restore duration and evidence reference; the UI explicitly describes external evidence prerequisites |
| DR evidence | PASSED/FAILED requires completed date, actual RPO/RTO and evidence; PASS cannot be recorded when either actual misses target |
| Dashboard fidelity | Failed drill count uses all matching rows rather than last 50; latest verified backup reads verified evidence across full history; dead-letter webhook count respects endpoint's branch scope |
| Regression | Automated safety assertions plus real two-connection MariaDB branch/edge/retention row-lock contention, wired into GitHub CI |

## Explicit release gates

- [ ] Final feature-branch exact SHA: CI success for migrations, all safety tests and MariaDB integration suites, TypeScript, ESLint, bilingual UI and Next.js production build.
- [ ] PR ready, merge expected SHA only; merged main SHA CI success.
- [ ] Hostinger exact deployment independently confirmed by owner.
- [ ] Manual UI, real backup restore, load/failover, live edge/analyzer connectivity and clinical UAT **deferred by user until entire LIS implementation is complete**.

## Boundaries / remaining scope

- Backup evidence in the LIS is not an automatic backup service nor independent verification of external artifacts; production backup jobs, offsite generations, object storage retention and restore tests need provider configuration/actual evidence.
- `READ_ONLY_CACHE` remains architecture reservation; offline clinical writes remain prohibited; edge events are staged rather than automatically applied.
- Analyzer Bridge PR #128 remains Draft and unmerged, requiring separate rebase/security/interface acceptance.
- High availability, automatic failover, multi-instance load performance and actual RPO/RTO cannot be demonstrated from application CI. Provider configuration and recovery exercise remain open.
- Retention archive export and schema/migration recovery acceptance remain part of master target; clinical/audit history cannot be destructively purged.
- SQL row-level locks and source safety tests do not replace operational disaster-recovery validation.
