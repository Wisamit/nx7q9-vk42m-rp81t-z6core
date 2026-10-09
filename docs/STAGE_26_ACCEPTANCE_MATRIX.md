# Stage 26 — Staged Price Reconciliation Without Financial Posting

**Baseline main:** `7e86bda9217321e256c9cec6cfad838022316b2f` (Stage 25 merged). Hostinger deployment is not implied by GitHub merge or CI.

## Existing system audit

- Stage 24 already exports price-list and price-item configuration and stages `PRICE_LIST_ITEM` as review-only. Stage 25 reconciles clinical components; neither stage authorizes a price commit.
- Current catalog import safe-commit allowlist remains `UNIT`, `CONTAINER`, `TEST`, `PANEL`; never auto-commit staged prices or rewrite historical invoices.
- Existing `PriceList` tracks organization, optional branch/client/referrer/contract scope, currency and effective window. `PriceListItem` uses `Decimal(18,4)` and effective dates. This stage reuses those models with no migration.

## Implemented engineering checks

| Control | Engineering evidence |
|---|---|
| Protected read-only review | `GET /api/catalog/imports/[id]/prices/reconcile` requires both `pricing.manage` and `catalog.manage`; batch belongs to current organization, at least one active branch scope required |
| Branch + department access | Only organization-owned price lists in the user's active branch scopes (plus organization-wide list), and authorized department tests are resolved |
| Exact decimal and effective dates | Price remains a string, validated against nonnegative `DECIMAL(18,4)`; explicit ISO UTC/date syntax and calendar validation; no floating-point amounts or currency conversion |
| Conflict evidence | Current live price-item windows, cross-page staged overlapping windows and parent-list date windows are conservatively flagged for governance; no override or automatic precedence chosen |
| Immutable financial history | No `PriceListItem`, invoice, payment, tax or historical record write; only an audit event containing counts/scope metadata |
| Bounded read / bilingual screen | 100 + 1 page, row-number cursor, no-store response, AR/EN review UI and explicit financial approval warning |
| Tests | `tests/stage-26-price-import-reconciliation.test.ts` for precision, dates, guards and no-write contract; `tests/stage-26-price-import-mariadb.integration.test.ts` for two-connection tenant/branch fixtures, exact stored decimal, 102-row page boundary and existing price conflict |
| CI | Migrations, full safety suite, MariaDB integration, TypeScript, lint, AR/EN UI and Next.js build through `.github/workflows/ci.yml` |

## Intentionally not yet authorized

1. **No governed price mutation, posting or effective-dated activation.** A separate approval workflow must define finance approvers, allowed price overlap handling, transaction isolation, audit, conflict retries, preservation of invoice snapshots, and rollback/retirement.
2. No invented tax, exchange-rate, cross-currency, contract-precedence or discount policy. Neither `READY_FOR_GOVERNANCE` nor success here constitutes approval.
3. Import is review-only and limited to the data supplied by the current staging normalization, not lossless round-trip restoration of every `PriceList` field.
4. Real clinical/financial reconciliation, multi-branch user acceptance, printer/analyzer UAT, tax sign-off and Hostinger deployment acceptance remain **DEFERRED** until the full LIS implementation is finished.
5. Analyzer Bridge PR #128 remains independent, Draft/unmerged and must be reviewed against current `main` before any merge.

**Scope:** Master Scope §§16–19, 63, 68–70, 79–80, 86–87; all 88 sections remain in force.
