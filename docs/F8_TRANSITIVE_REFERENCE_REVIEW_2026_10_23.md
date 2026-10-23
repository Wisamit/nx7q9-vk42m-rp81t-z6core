# F8 §87 — Transitive DRAFT review reference closure (2026-10-23)

Baseline: `main=7f2f4108ab53bb72531c94b348aa306cfc796985` after merged PR #377 and independent main push CI #39989060067 COMPLETED SUCCESS. Full original `02_MASTER_SCOPE.md` 88-section scope retained.

## Verified source defect

The pre-existing `spreadsheetReferenceFindings` admitted a syntactically valid staged `PACKAGE` as a reference for a staged `PRICE_LIST_PACKAGE_ITEM` regardless of whether the package's member test references resolved. A draft PACKAGE pointing to an absent, foreign-branch, inactive or otherwise unavailable test was correctly marked ERROR, while its dependent price item could receive only `CSV_REVIEW_REFERENCE_STAGED_ONLY` WARNING. Duplicate code aliases could also be treated as reliable staged parents in direct resolver use.

## Software remediation

The new pure `reviewEligibleStagedReferences` helper resolves batch-level, typed, case-normalized staged reference identity only when unique and non-ERROR. All duplicates are excluded from staged-reference eligibility even when one was already invalid. A staged PACKAGE must have at least one member, and **every** member TEST must resolve to a currently authorized ACTIVE live test or an unambiguous non-ERROR staged TEST; otherwise the package cannot satisfy a downstream tariff reference. This propagates the missing/out-of-scope ERROR to its linked price row. A valid staged package remains WARNING-only pending a separate qualified review; it is **never** treated as live or published.

The existing same-tenant, branch/department-scoped, active-only reference queries and their transaction/re-authorization boundary are unchanged. The immutable source checksum, request idempotency, author-private `CSV_REVIEW` batch status `DRAFT`, no-commit/no-revalidate guards and append-only audit remain. No real patient, MDB, device profile, secret, fiscal rate, tax rule or tariff published. Tests cover missing and inactive/out-of-scope membership, invalid staged test, duplicated codes, staged dependency chains, malformed packages, CSV/XLSX review parity and source-level DRAFT-only authorization gates.

## Remaining safety boundaries

- §75: sample interference, analyzer methods and clinical interpretation require qualified clinical/vendor rules and approval; BLOCKED_EXTERNAL.
- §86: tax/currency/accounting policy cannot be inferred; BLOCKED_EXTERNAL.
- §87: this closes one proven DRAFT reference-graph inconsistency. Complete field-level import/export and separately governed activation across all settings still PARTIAL.
- §88: original Access source row lineage, exact source mapping and expert reconciliation remain BLOCKED_EXTERNAL.
- F7 private browser 0/486 NOT_EXECUTED; F8 qualified 88/88 case UAT NOT_EXECUTED and seven signoffs outstanding: NO_GO. No Hostinger deploy SHA, device commissioning or restore evidence asserted.

Release gate: current exact feature HEAD full CI COMPLETED SUCCESS; expected-head merge; independent main push CI COMPLETED SUCCESS on actual merge SHA. No manual user/device testing requested during coding phase.
