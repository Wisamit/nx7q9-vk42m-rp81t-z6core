# Stage 81 — Full Multi-Branch Laboratory Worklist Pagination

## Baseline and operational gap
- Baseline: Stage 80 merged main SHA `4800dfe259c5703b7284b5e8e77d06f3f8185607`, independent CI #1060 SUCCESS, owner-confirmed Hostinger deployment.
- Master Scope §30 requires department- and analyzer-filtered laboratory worklists across branches, with efficient manual/bulk result entry and TAT monitoring.
- `src/app/worklists/page.tsx` previously loaded a maximum of **300 rows**, with no pagination or overflow disclosure. In a busy multi-branch laboratory, older eligible tests could silently disappear from the only operational list despite still awaiting result entry/review.

## Delivered functionality
- An explicit **50-item page + sentinel** bound replaces the 300-row cutoff; older authorized work remains accessible via “Next 50 tests” and “First page”.
- A stable keyset cursor uses `order_items.created_at ASC, id ASC` to handle multiple work items registered at the same millisecond without duplicate/omitted rows.
- A cursor has a bounded, validated timestamp and ID and is tied to an SHA-256 fingerprint of the complete existing filter set (`q`, `status`, `department`, `branch`, `priority`, `specimenStatus`, `due`, `analyzer`). Changing filters invalidates an earlier position rather than silently skipping relevant tests.
- Existing **tenant, active branch and department scopes** are re-evaluated and applied on *every* page along with ready-specimen status, analyzer assignments, priority and SLA/TAT filters. A cursor **does not authorize access** to any order.
- Each page's bulk-entry form is bounded to its 50 displayed items, reducing page size and preventing accidental bulk actions on hidden next-page records. Dashboard summary counters explicitly disclose that they refer **only to the currently visible page**, not all pending organization-wide tests.
- EN/AR labels and warnings for invalid/expired cursor input; on invalid cursor, display the first page. Existing laboratory result entry, analyzer routing, validation, critical flags and SLA controls remain unchanged.

## Automated acceptance
- `tests/stage-81-worklist-complete-pagination.test.ts`: validates stable same-timestamp tie ordering, cursor encoding and filter invalidation, sentinel exclusion, filter-preserving links, and source-level tenant/branch/department/specimen/analyzer/priority gates with bounded bulk editing.
- `tests/stage-81-worklist-complete-pagination-mariadb.integration.test.ts`: real two-session MariaDB with **315 authorized ready work items** beyond the old 300 cap, plus restricted same-organization branch, restricted department and foreign-tenant data. Verifies complete seven-page walk, no duplicates, strict isolation, and priority-filtered pagination.
- MariaDB suite explicitly wired into `.github/workflows/ci.yml` alongside migration validation, all existing clinical/financial and branch-isolation suites, TypeScript, lint, bilingual UI and production build.

## Boundaries / acceptance
- This changes read-only queue navigation; result storage, audit, billing, specimen custody, release policies and historical reports remain untouched.
- **No migration and no new Hostinger environment variable.**
- A multi-click cursor traversal observes live data. Concurrently added/deleted work items can shift which page contains them, but the cursor remains stable for unchanged rows; users can restart at page one to refresh.
- This stage does not assert complete lifetime TAT analytics or organizational aggregate counts: existing page counters now clearly identify their bounded scope.
- Manual clinical/device/performance acceptance remains deferred to final LIS UAT, not waived.
- PR #128 Analyzer Bridge must remain OPEN/DRAFT, untouched and unmerged.
