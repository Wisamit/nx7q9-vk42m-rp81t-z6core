# Stage 39 — Bounded Read-Only Price Reconciliation Review UI

**Baseline:** Stage 38 merged `main` at `74914d1c412fbfc8be5d748c615a17b48b90912e`, with completed successful main CI. Current deployment remains owner-verified independently.

## Observed gap

The staged price reconciliation screen already existed and was permission-gated, but its `Next 100 rows` button appended each visited page to client state without a memory bound. It also rendered a successful HTTP response without checking the backend's read-only, no-currency-conversion and approval-required contract. A response regression could appear as a financial approval or disclose a processed/out-of-scope candidate.

## Implemented scope

- Replace the accumulated staged price results with exactly the current validated 100-row-or-smaller page. Support restart, previous-page and next-page navigation by verified integer cursors. Keep the last validated page visible if a request fails.
- Require the explicit `liveWrites: false`, `currencyConversion: false` and `approvalRequired: true` response markers before displaying monetary candidates; fail closed on unexpected row count, ordering, cursors, field types or missing markers.
- Reject a response that exposes any candidate financial value, price/test code, effective date or currency on rows marked already processed, malformed/error or outside the authorized price-list scope.
- Display redacted/unresolved entries without monetary values and provide bilingual English/Arabic explanations for known price-window and governance warnings.
- Preserve the existing server-side requirements: `catalog.manage` and `pricing.manage`, organization/active branch and department-scoped lookups, the 20,000-row cross-page overlap review bound and read-only audit metadata.
- Add deterministic unit/source contract tests in `tests/stage-39-bounded-price-review-ui.test.ts`, discovered by existing `npm run test:safety`. The pre-existing Stage 38 two-connection MariaDB test remains a required CI gate.

## Safety and acceptance boundaries

This increment does **not** activate or approve a price, change invoices, create accounting entries, convert currencies, choose branch/client/contract precedence or modify historical financial snapshots. `READY_FOR_GOVERNANCE` means a candidate is reviewable, **not** approved or posted.

Engineering acceptance requires a successful CI run on the exact final feature HEAD and on the exact merged main SHA, including migrations, Prisma, safety tests, MariaDB integration, TypeScript, ESLint, i18n/theme and production build. Do not treat a successful CI run as confirmation that Hostinger has deployed; owner verifies hosting separately.

The full 88-section Master Scope remains in force. Financial activation/governance, full import/export and the legacy migration scope remain open. Analyzer Bridge PR #128 is separate, Draft and unmerged. Manual clinical/financial, device, analyzer and multi-branch UAT remain **DEFERRED** until the complete system is implemented, not marked accepted.
