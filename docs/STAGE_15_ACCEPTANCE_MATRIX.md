# Stage 15 — Analytics & Management integrity and acceptance

**Base SHA:** `b50eb7ea312ea7e6eb01e07490ec5a1bfcab9f2e`, `main` CI #853 success and owner-confirmed Hostinger deployment.  
**Authoritative scope:** `02_MASTER_SCOPE.md` §§65–71, Phase 16 of `07_IMPLEMENTATION_ROADMAP.md`. This increment does not remove any remaining Master Scope target.

## Existing code reused

Branch-aware management dashboard, test volume, source/referrer analytics, test profitability coverage, specimen rejection rates, QC/critical-result counts, TAT distribution, inventory-linked cost and quality indicators. Existing `src/lib/financial-reporting.ts` and `billing-adjustments.ts` provide precision-safe DECIMAL(18,4) aggregation; their patterns are reused rather than duplicating accounting policy.

## Stage 15 delivery

| Area | Verified gap and new guard |
|---|---|
| Dashboard finance authorization | Financial snapshot queried and displayed for users without `billing.view`. Now gated on both DB access and rendering by billing permission. |
| Financial arithmetic | Replaced JavaScript floating-point accumulated currency totals with existing bigint-backed `aggregateFinancialReport` and fixed four-decimal formatting. |
| Refund/credit reporting | Management report now explicitly includes dated POSTED refunds, ISSUED credit notes, gross and net collections separately by currency. |
| Temporal semantics | Issue-period invoice totals and CURRENT receivable balances are explicitly distinguished from payment/refund/credit transaction flows; no implied historical as-of balance. |
| Branch comparison | Adds organization-scope patient counts, ordered test volume, invoice averages by currency, branch discounts, current outstanding and stored-due-date TAT SLA performance. |
| Profitability | Cost attributed from **current mutable lot unit cost** is labeled indicative, never asserted as an immutable historical valuation. Published margin is withheld if attribution is partial, estimated or multi-currency. |
| Dataset truncation | Take-limited queries cannot silently publish false totals: if any dataset hits its safe row limit, entire report fails closed with a bilingual filter-range warning. |
| Date filters | Invalid/reversed custom date ranges rejected rather than silently expanding to all-time totals. Server-time date boundary limitation is disclosed. |
| Regression | Precise-money, currency isolation, permission, margin, cap, temporal labeling and MariaDB integration tests included in GitHub CI. |

## Remaining items / boundaries

- [ ] Final exact-head branch CI success: migration checks, safety suite, every prior MariaDB test plus Analytics DECIMAL suite, TypeScript, ESLint, AR/EN/theme and production build.
- [ ] PR reviewed/merged using expected head SHA and exact `main` merge CI success.
- [ ] Hostinger deployment SHA confirmed by owner separately from GitHub.
- [ ] Final UI/real clinical and accounting UAT and formal quality acceptance **DEFERRED** until entire project is implemented.
- [ ] Historical inventory consumption valuation requires **immutable unit-cost snapshot at movement posting** plus an appropriate backfill policy; no retroactive cost estimates should be silently treated as historical facts.
- [ ] Analytics scalability beyond initial row limits requires paginated/SQL grouped rollups with verified tenant isolation and performance.
- [ ] Per-branch-local timestamp windows, all scoped filters (source/referrer/test/payment method/cashier/client), additional phase-specific TAT stages and formal department analytics remain part of full target; not removed or claimed complete here.
- [ ] Analyzer Bridge PR #128 remains Draft, separate and unmerged.

**No external certification claim:** Engineering tests validate financial arithmetic and query behavior only; they do not replace reconciliation against real provider/accounting data, clinical TAT acceptance, invoice policy or production UAT.
