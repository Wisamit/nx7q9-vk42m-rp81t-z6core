# Stage 32 — Controlled Canonical CSV Reference-Range Review Staging

**Base:** `66b27b4b6d25cc42ad10def0d851ecff807d3475` (Stage 31 Hostinger owner-confirmed, exact-main CI #910 successful).

## Scope audit

Stage 24 configuration export and Stage 27 review CSV are read-only, and Stage 28 imports a **separate canonical CSV format**, restricted to `COMPONENT` and `PRICE_LIST_ITEM`. Legacy `REFERENCE_INTERVAL` import has its own clinical approval flow; it was not safe to enable CSV rows on that path. Master Scope §87–88 still requires comprehensive clinical configuration import/export and MDB migration coverage.

## Stage 32 implemented

- Extends the canonical CSV review parser to accept `REFERENCE_INTERVAL`, retaining the existing component/price upload format. Bounded 2 MiB, 20,000 rows, 24 columns maximum, strict headers/quotes/UTF-8 and no formula evaluation. CSV records remain source evidence, not executable imports.
- Adds a separately downloadable English-field-name **reference range template** exposed only to users with `catalog.reference_ranges.manage`. Arabic and English values are preserved verbatim.
- Supports `testName`, `unit`, `sex`, `ageFrom`, `ageTo`, `ageUnit`, `low`, `high`, `normalTextEn`, plus `legacyKey`; normalizes source decimal/age/context values without floating-point conversion or inferred clinical meaning. Missing/invalid test, unit, sex, age-unit, incomplete ages, invalid precision, inverted age bounds, inverted low/high, empty interval and oversize text become explicit row errors.
- Every otherwise valid range has `RANGE_REVIEW_CLINICAL_APPROVAL_REQUIRED` warning. Uploaded batch stays `CSV_REVIEW / DRAFT`; even warning-only rows can never go through master commit, revalidation, reference-range import, unit preparation or alias mutation routes.
- Requires `catalog.manage` **and** `catalog.reference_ranges.manage`, with Stage 31 active organization/branch/department scope for CSV uploads containing reference ranges. `PRICE_LIST_ITEM` additionally retains independent `pricing.manage`.
- Because batches do **not** yet contain a branch-bound reviewer assignment, CSV clinical source evidence is visible only to its original uploader **with** clinical range permission and active branch scope. This is enforced before the batch detail loads raw/normalized source data; the catalog batch list suppresses other authors' CSV range batches.
- Adds unit/source tests (including Arabic UTF-8 BOM, exact decimal strings, zero-negative and reversed intervals, malicious formula-like text stored only as text), and two-connection MariaDB tests for transaction visibility, tenant isolation, precision and zero live clinical interval mutations. CI runs all previous tests and the new MariaDB integration.

## Explicit boundaries

- This is **not** approved clinical range import. No range `ReferenceInterval` create/update, no critical-limit activation, no retroactive medical report edits, no change to released values.
- Range bounds are staged and checked for syntax only; a qualified clinical reviewer must later map components/methods/specimens/branches, determine applicability, age/sex semantics, compare overlaps/critical limits and formally approve a new effective-dated version before activation.
- The existing Stage 27 CSV export remains a flat review report and **cannot** be round-tripped as this separate canonical upload template.
- No `.xlsx` parser, component/price governed commit, full MDB microbiology/comment/source mappings or clinical UAT yet. All 88 Master Scope sections remain in target scope. Analyzer Bridge PR #128 remains independent and draft/unmerged.
- Hostinger deployment/physical instrument/clinical reviewer acceptance not implied by GitHub CI.
