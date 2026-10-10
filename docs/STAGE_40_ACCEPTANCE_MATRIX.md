# Stage 40 — Fail-Closed Scope Enforcement for Staged Price Reviews

**Baseline:** owner-verified Hostinger Stage 39, merged `main` `a89fad6360e558b2c7f280121024d5114bd43f18`, with exact merge CI #930 SUCCESS.

## Identified disclosure risk

The generic CSV price review treated any price list with `branchId = null` as organization-wide, even when `scopeType` was `CLIENT`, `CONTRACT`, `SOURCE` or `REFERRER`. That could permit ordinary finance/catalog reviewers to inspect specialized client/contract pricing without a dedicated authorization/approval policy. The generic API also looked up all branch-null price lists, independently of the price-list type.

## Changes

- `authorizedStagedPrices` now requires both explicit scope type and branch linkage:
  - `ORGANIZATION` must have `branchId = null` and the reviewer must have active branch access.
  - `BRANCH` must have a branch in the reviewer's active scopes.
  - `CLIENT`, `CONTRACT`, `SOURCE`, `REFERRER`, missing/unknown types or inconsistent branch associations fail closed in generic CSV review.
  - Duplicate normalized price-list codes fail closed rather than resolve arbitrarily.
- Import-batch page selects `scopeType` and checks the **whole batch** before loading price source data, validation issues or monetary summaries.
- Price reconciliation API constrains the permitted price-list lookup to exactly organization-wide or allowed branch scopes. Missing/out-of-scope lists continue to return a redacted `PRICE_LIST_SCOPE_UNRESOLVED` row without currency, codes, amounts, dates or financial identities.
- Retained existing prerequisite permissions `catalog.manage` + `pricing.manage`, organization isolation and active-branch checks; no financial writes or historical changes.
- Expanded existing Stage 29 two-session MariaDB regression to model `CLIENT` and `CONTRACT` scopes, and added `tests/stage-40-price-scope-review.test.ts` for malformed/ambiguous scope and API/page guards.

## Explicitly NOT delivered

This **does not** remove client, contract, source or referrer price lists from the product. It defers only their generic CSV **review** until dedicated contract/client visibility, effective-date precedence and financial approval governance are specified and implemented. No price activation, accounting, invoice mutation, price revision, currency conversion or contract fallback is attempted.

The whole 88-section `02_MASTER_SCOPE.md` remains mandatory. Standalone Analyzer Bridge PR #128 remains Draft/unmerged. Automated CI acceptance on exact feature HEAD and final merged `main` SHA (Prisma, safety, MariaDB two-session, TypeScript, lint, bilingual UI and build) is required. Manual clinical, billing, integration, barcode/analyzer and branch UAT remains **DEFERRED** until the complete system is implemented. Hostinger deployment requires independent owner verification.
