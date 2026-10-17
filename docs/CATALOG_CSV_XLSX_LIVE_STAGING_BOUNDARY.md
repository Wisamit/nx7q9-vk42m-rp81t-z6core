# Controlled CSV / XLSX catalog review staging: live write authorization

## Evidence from current code

The unified `POST /api/catalog/imports/csv` handles both human-edited CSV
and XLSX. The request was checked against **session** `catalog.manage`,
price and clinical-range rights, and initially scoped branch IDs before
parsing and staging. However the later Prisma transaction created the DRAFT
review batch and all source rows **without re-checking live user, role,
organization, branch or department permissions**. A user whose privilege was
revoked while their upload was being parsed could still write staged source
information. These rows are author-private but are not automatically
authorized merely because they are DRAFT.

The signed configuration JSON bundle import had a live locked permission
boundary already; this package closes the remaining CSV/XLSX ingestion gap.

## Implemented controls

- After fully bounded UTF-8/CSV/XLSX parsing, obtain the existing tenant
  serialization lock for an **ACTIVE organization** in the same transaction.
- Before creating any batch, row or audit event, re-authorize CURRENT ACTIVE
  actor, ACTIVE same-tenant roles with `catalog.manage` and any additional
  `pricing.manage` or `catalog.reference_ranges.manage` needed by the
  mixed upload. Permissions may come from distinct active roles; an old
  session permission is a ceiling, not permanent approval.
- The current allowed branch list is the intersection of the initially
  granted ACTIVE tenant branches and the latest database assignments. The
  active branch must remain granted; price-list candidates that specify a
  BRANCH scope must resolve to an authorized branch, rechecked **inside**
  the tenant-locked transaction.
- For uploads involving clinical/composite/price data, current department
  grants are intersected with session-time grants. A previously restricted
  user must not become unrestricted after their grant was revoked, and
  newly added grants do not widen an already queued upload.
- Denials return 403 without creating the batch or audit event. The
  original successful outcome remains `CSV_REVIEW / DRAFT`, no validated
  status, activation, prices, clinical rules or amendments. The author-only
  visibility protections for source filename/row data remain unchanged.
- Existing 2 MiB body limits, parser guards, XLSX zip defenses and CSV
  numeric lexemes remain in place.
- Pure policy + source-boundary tests and disposable synthetic MariaDB
  two-session role/branch/department revocation tests are part of full CI.

## Limits / release acceptance

This improves the **review intake boundary**, not lossless 9/10-group
spreadsheet export/activation. The independent clinical and financial approval
workflow and exact MDB source-row reconciliation (§87/§88) remain partially
unresolved. Owner/accountant tax rules (§86) and analyzer/clinical policy
signoff (§75) cannot be inferred here. Issue #250 still NO_GO for qualified
clinical/finance/vendor/DR UAT, Issue #265 rendered browser acceptance
NOT_EXECUTED on private synthetic staging. No medical, personal, secret, or
production source data were added to the public repository.
