# Stage 35 — Exact Staged CSV Range Context Duplicate / Conflict Review

**Base:** `73530f75efa3f1bfa7aa46d71034f6614de05ea9` (Stage 34 merged, exact-main CI #918 SUCCESS, Hostinger deployment owner-confirmed).

## Audit and gap

Stage 34 reconciles an uploaded reference-interval row with a scoped test, one active component, and exact unit, but did not compare the row's **sex/age/test/unit context against other staged rows in the same batch**. Contradictory ranges across a later CSV page could be missed by the reviewer. Stage 35 adds advisory and purely read-only batch-wide context checks.

## Implemented

- `stagedRangeContextIndex` builds **exact** source context keys from Unicode-normalized test name/code text, unit code/symbol text, sex, age bounds and age unit. It does not infer equivalent test names, clinical age conversion, cross-unit equivalence, effective dates or method/specimen identity.
- Decimal-only canonicalization uses **string operations**, not JavaScript floats: `12.500000` and `012.50` are equivalent for duplicate detection; stored source values stay unchanged. Invalid/processed/error rows do not contribute.
- Two or more staged `VALID/WARNING` rows matching one exact context and identical clinical bounds/text add `DUPLICATE_STAGED_RANGE_CONTEXT`; different clinical bounds/text add `CONFLICTING_STAGED_RANGE_CONTEXT`. All remain `REVIEW_REQUIRED` (or `BLOCKED` under existing reconciliation), never approved or automatically posted.
- Stage 34 scoped/uploader-gated `GET .../ranges/reconcile` now reads all candidate contexts **from only the same tenant-checked batch**, bounded to 20,000 rows (20,001 sentinel rejects with 409), before comparing the current 100-row page. Prevents missing duplicates at a 100/101 page boundary.
- For unresolved or out-of-scope tests the response continues to suppress raw candidates. The audit records only aggregate conflict/duplicate counts and never source clinical values.
- No clinical component/result/reference interval write, no migrations, no historical report/pricing changes.
- Pure source/unit tests and two-independent-session MariaDB fixture verify exact duplicate, conflicting limits, non-equivalent context, invalid/processed exclusion, cross-page and cross-tenant batch isolation. New MariaDB gate in `.github/workflows/ci.yml`.

## Clinical limitations explicitly deferred

- Identical text-based context is **not** complete clinical overlap evaluation. Different aliases, age units, sex applicability, pregnancy/population, methods, specimen types, analyzers, branches or effective-date windows can require overlapping interval assessment by a qualified clinical reviewer.
- No automatic import approval, activation, clinical threshold inference, merging or replacement. A separately governed clinical import workflow needs explicit approval authority, effective-date/version policy, overlap checks, double-approval policy when appropriate and safe transactional write semantics.
- Current Stage 27 review CSV and Stage 32 canonical review CSV are distinct representations; no universal Excel/.xlsx import or full legacy MDB transformation yet.
- All **88 sections** of `02_MASTER_SCOPE.md` remain binding; Analyzer Bridge PR #128 stays independent Draft/unmerged; Hostinger confirmation and clinical UAT are independent of green CI.
