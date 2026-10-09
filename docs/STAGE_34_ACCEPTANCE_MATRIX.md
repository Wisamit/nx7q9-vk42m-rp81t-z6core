# Stage 34 — Scoped CSV Reference Interval Reconciliation

Baseline: `20319135cd32c46ea03ff3ac5b63c0bbad8c35d2` (Stage 33 main, CI #916 SUCCESS).

## Audited need
Stage 32 accepts reference-interval canonical CSV into immutable review-only staging but does not yet provide an explicit, dedicated component/unit identity reconciliation; using the legacy MDB write route would be clinically unsafe. Stage 33 secured component review with active branch and department authorization.

## Implemented
- New bounded, read-only `GET /api/catalog/imports/[id]/ranges/reconcile?after=<rowNumber>`.
- Requires both `catalog.manage` and `catalog.reference_ranges.manage`, valid active scoped branch and department-aware test queries, current organization, review-only CSV batch and **original uploader**.
- Deterministic 100-row paging and strict cursor guard; accesses only staged REFERENCE_INTERVAL rows.
- Uses exact test code/name, exact unit code/symbol, single ACTIVE component with matching unit and optional matching test default unit. Ambiguous, missing, inactive or mismatched candidates remain `BLOCKED`. No fuzzy/AI clinical identity matching.
- Error-stage records cannot be recognized as ready. `REVIEW_REQUIRED` explicitly demands clinical context review, overlap assessment and manual approval; it never means clinically approved. Unresolved/out-of-scope candidates are redacted and not echoed as raw clinical source text by this endpoint.
- Audits aggregate review counts without source values and sends `Cache-Control: private, no-store`.
- Adds source/unit tests and two-connection MariaDB fixture test covering organization, branch and department scoped test resolution. CI invokes integration test.

## Deferred
- No `ReferenceInterval` writes or activation, no approval, no automatic age/sex interpretation, no equivalent-unit conversion, no auto-conflict resolution.
- Production clinical mapping of method/specimen/analyzer and effective dates, range overlap validation, authorized approver workflow, and integration into governed import remain future stages.
- Stage 27 flat CSV review export is not a round-trip of the canonical CSV upload.
- All 88 sections of Master Scope remain in scope. Analyzer Bridge #128 remains Draft and independent. Real clinical and Hostinger UAT not implied by CI.
