# F8 §§75/87 — Atomic reference interval governance and concurrent approvals (2026-10-24)

**Baseline:** `main=e4264b351e1bbdcf784d01ae2a0724c10ed98cba`, independent main push CI #40068642398 COMPLETED SUCCESS. All 88 original Master Scope sections retained.

## Proven clinical concurrency gap

The original `PATCH /api/catalog/reference-intervals` read DRAFT status, existing approved intervals, conflicting time windows, and current role/branch scope **outside** the eventual write transaction. The transaction then closed predecessor versions and unconditionally approved/retired the originally loaded row. Two concurrent approvals against the same `TestComponent`, different DRAFT UUIDs and identical effective instants could both see no competing newly approved interval and end with contradictory ACTIVE clinical reference intervals. Concurrent RETIRE/APPROVE or grant revocation likewise relied on a stale preflight snapshot. The POST DRAFT path had a similar grant/active component/method/analyzer/specimen time-of-check-to-use gap.

## Software correction

- Lock the ACTIVE `organizations` row `FOR UPDATE` before any reference interval CREATE, APPROVE or RETIRE for that tenant. A single row lock serializes even different DRAFT IDs, avoiding phantom overlapping approved intervals. Lock active branch rows consistently in ID order.
- Re-check current ACTIVE actor, organization-specific `catalog.reference_ranges.manage` or `catalog.reference_ranges.approve` role grants, and **both live DB and original-session branch scopes** within that same write transaction. An organization-wide reference interval requires all currently active branches; deactivation, reactivation and new branches cannot silently widen approval.
- For DRAFT inserts, lock ACTIVE tenant TestComponent/LabTest and any supplied ACTIVE method, specimen type or analyzer source row, checking analyzer branch match. Reject any source deactivated since preflight.
- For PATCH, re-lock the requested interval row, re-read the current tenant row and ACTIVE eligible parent component, re-query the current approved competitors **under the tenant lock**, re-run existing `planReferenceIntervalApproval` without changing clinical overlap or age/sex policies, then use conditional `updateMany` compare-and-swap transitions for predecessor closure, DRAFT→APPROVED and APPROVED→RETIRED. Any lost race or stale state fails closed with a transaction rollback and no partial audit.
- Keep original effective-day granularity, critical limits, exact DECIMAL calculations, audit actions, version history, immutable released reports and branch ownership. No clinical input or range is inferred/auto-approved.
- Add pure in-memory role/grant/context gate regressions and source-boundary checks, plus an independent **two-connection MariaDB** concurrent same-start approval regression wired to CI. The synthetic fixture must remain private-data-free.

## Operational acceptance

This implements **software serialization**, not qualified clinical validation. §75 analyzer-specific interference interpretation, specimen collection guidance, age/pregnancy population reference review and qualified doctor/lab signoff remain BLOCKED_EXTERNAL. §87 complete approved field-level F2 configuration activation remains PARTIAL; §86 qualified accountant/tax choices and §88 original MDB row lineage require independent evidence. F7 protected browser 0/486 NOT_EXECUTED, F8 qualified real-world 0/88 NOT_EXECUTED, seven qualified signatures absent: **NO_GO**. No Hostinger deployment or instrument/QC/drill evidence is asserted.

Require exact branch HEAD CI COMPLETE SUCCESS before expected-head merge, then a new independent `main` push CI COMPLETE SUCCESS on the merge SHA.
