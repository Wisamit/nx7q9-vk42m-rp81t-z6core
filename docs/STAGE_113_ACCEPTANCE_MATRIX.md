# Stage 113 — Branch-scoped patient-promised report follow-up

**Verified base**: Stage 112 main `59e2ea1687dd3fe4cb6775b4a7b9dff2b46d475e`, owner confirmed successful Hostinger deployment; CI #1226 success.

## Operational gap and authority

- Master target `02_MASTER_SCOPE.md` continues to require end-to-end orders, reporting, branch permissions, TAT/SLA monitoring, bilingual operation and preservation of clinical history.
- Stage 112 introduced independent, immutable UTC + original local time + IANA timezone snapshots for staff-entered promises. Main previously lacked a cross-branch, action-oriented follow-up queue for those promises.
- This stage surfaces **only recorded promises**, never fills historical NULL values from lab TAT or global settings.

## Implemented

1. New read-only `/orders/delivery-queue` linked from Orders and guarded by **both** `orders.view` and `reports.view`.
2. Strictly validated branch, exact accession, follow-up status and stable page filter; a requested branch outside the logged-in user's organization-scoped branch permissions fails closed.
3. Parameter-bound SQL joins orders to the **current** diagnostic report version (`v.version = r.current_version`). Counts and paged rows share the same tenant/branch predicates and deterministic promised UTC/id ordering.
4. States:
   - `OVERDUE`: promised UTC passed without a current `FINAL` or `AMENDED` report.
   - `DUE_SOON`: pending final report, UTC promise between now and next 24 hours (inclusive).
   - `FUTURE`: pending final report, UTC promise later than 24 hours.
   - `PENDING`: all records with a staff promise but no current final/amended version (default).
   - `CURRENT_ISSUED`: latest report version is final/amended. **This is not evidence of physical printing, sending, patient receipt or acknowledgement**.
   - `ALL`: all recorded promises except cancelled/draft orders.
5. A retracted/partial **current** report is considered pending even when older versions were final. Cancelled orders are excluded. The page shows saved branch-local time, saved timezone and UTC instant without recalculation from mutable branch configuration.
6. No mutation endpoints, schema migration, automatic messaging, patient notification claims, report release, billing adjustment or historical rewrite.

## Automated acceptance

- Safety: exact query validation, SQL parameter binding, tenant/branch authorization, no cancelled/draft orders, current-version gating, UTC interval edges, pagination and bilingual UI disclaimers.
- Real MariaDB: two tenants, two branches, old-final/current-retracted report, partial report, future retracted report, final/amended issued versions, cancelled order, cross-branch and cross-tenant isolation and accurate count/pagination.
- Full CI includes Prisma migrations, Stage 113 safety & MariaDB, all previous safety & MariaDB suites, TypeScript, lint, UI i18n/theme and production Next.js build.
- Owner defers clinical/patient outreach workflow testing, physical printing, device integration, browser UAT, user training and deployment restoration evidence until final acceptance.

## Gate
- [ ] Feature exact-head CI SUCCESS
- [ ] Ready PR merged with expected HEAD SHA
- [ ] Independent main CI SUCCESS at merge SHA
- [ ] Owner-managed Hostinger deployment confirmed separately
- [ ] Clinical/manual/print/provider UAT DEFERRED (not assumed passed)
