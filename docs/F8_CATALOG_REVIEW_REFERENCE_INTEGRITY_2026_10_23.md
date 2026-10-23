# F8 §87 — Cross-entity CSV/XLSX DRAFT Reference Integrity

**Base:** main `38bcff592db5fce010baa0c4224c142619575bf3` after merged PR #375 and independent main CI #39976127270 SUCCESS.

## Proven engineering gap

The existing import accepted a syntactically reviewable COMPONENT, PANEL/PACKAGE or PRICE_LIST_ITEM/PRICE_LIST_PACKAGE_ITEM row without checking whether referenced test/unit/package/tariff masters were ACTIVE, same-tenant, authorized for the current clinical department/branch and, for a package, entirely visible at the current operational branch. This meant a draft could incorrectly look review-ready despite a missing or inaccessible parent, even though all CSV_REVIEW batches were prohibited from live commit. The new guard identifies this discrepancy before persisting the review evidence.

## Implemented

- The review parser and previously merged tariff date/DECIMAL(18,4)/duplicate-window checks are preserved.
- AFTER the active organization FOR UPDATE lock, live role and branch/department recheck, and idempotency replay gate, a read-only cross-entity resolver looks up referenced masters under the same SQL transaction. Queries are bounded (400 codes per IN query) and scope to currently authorized active organization, branch, department and generic price-list scope.
- COMPONENT parent test and optional unit; PANEL/PACKAGE all explicit test members; test/package tariffs both their parent price list and test/package. A commercial package must contain at least one member and every member must remain clinically visible at the reviewer branch.
- ACTIVE visible referenced master: no issue. A new master found **only in this unapproved spreadsheet batch**: a `CSV_REVIEW_REFERENCE_STAGED_ONLY` WARNING, never a fabricated live FK. Missing, INACTIVE, other-branch or other-tenant reference: `CSV_REVIEW_REFERENCE_MISSING_OR_OUT_OF_SCOPE` ERROR. The persisted finding is generic and does not leak an out-of-scope identity.
- Pre-existing syntactic and cross-row identity errors mean an invalid staged parent cannot satisfy a dependency. The batch retains every row and finding for a qualified reviewer, preserves original source checksum, created-by identity, immutable DRAFT status and audit event. Repeat upload remains idempotent.
- Pure/parser/XLSX regression and a real independent two-connection MariaDB test for tenant, status, branch, mixed-package and financial isolation are included and wired to CI.

## Deliberate limitations

The check covers **documented code-level references**, not semantic medical equivalence, unit conversion, method compatibility, inheritance, patient history, activated catalog updates or finance postings. Clinical reference intervals have no safe unique component mapping in the legacy spreadsheet; the existing specialist clinical review and signed atomic JSON bundle remain necessary. Client/contract tariffs and analyzer mappings are not guessed into generic price-list scope.

### Master Scope and acceptance

- §75: clinical/analyzer-specific interpretation policy remains BLOCKED_EXTERNAL until qualified signoff.
- §86: local tax/currency/exchange and accounting policy remain BLOCKED_EXTERNAL; no automatic tax/rate or currency conversion.
- §87: safer DRAFT referential review now implemented, but **full source-to-target field-level roundtrip and independently governed activation still PARTIAL**, not marked complete.
- §88: original MDB/ACCDB row-level source parity and expert review remain BLOCKED_EXTERNAL. No private MDB or PHI uploaded to GitHub.
- F7: protected browser 0/486 NOT_EXECUTED. F8: 88/88 qualified real-world UAT cases NOT_EXECUTED; seven independent reviewer signatures absent. **NO_GO.**
- Full original 88-section Master Scope preserved; no Hostinger deployment is asserted by CI.

**Gate:** exact feature HEAD CI must be COMPLETED SUCCESS before expected-head merge; independent main push CI must be COMPLETED SUCCESS on the resulting merge SHA. Public-repository browser screenshot collection remains disabled until an approved private synthetic environment is provided.
