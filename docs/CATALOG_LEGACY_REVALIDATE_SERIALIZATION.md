# Legacy MDB catalog: live staging and revalidation safety

## Reproduced source defects

`POST /api/catalog/imports` bounded the source JSON (32 MiB,
20,000 rows), validated its rows and checked permission **only at session
entry**. It created a batch and raw source rows later in a transaction
without a current ACTIVE organization lock, active user/role permission
recheck, branch grant, or department revocation ceiling.

`POST /api/catalog/imports/[id]/revalidate` normalized and validated all
rows **before** opening its transaction, then updated the batch and row
statuses based on that potentially outdated source snapshot. It checked
session-level `catalog.manage` only, did not distinguish the original
creator of a legacy batch, and did not enforce current pricing/range
permissions for revalidation of those source groups.

## Implemented

- Both operations use the active organization `FOR UPDATE` lock and the
  shared *current-database* catalog staging authorizer. Active same-tenant
  user/roles and active branch grant are required; clinical department
  grants are intersected with the original session scope, including
  revocation / newly restrictive grants.
- Legacy JSON intake now requires conditional `pricing.manage` for any
  `PRICE_*` class and `catalog.reference_ranges.manage` for reference
  intervals, both at preflight and **inside** the database transaction.
  Any revocation denies the batch **before** creating source rows or audit
  events. Original CSV/XLSX and signed bundle controlled review paths are
  unchanged.
- Legacy batch revalidation acquires the same tenant lock **before**
  loading its rows, requires original creator ownership, explicitly allows
  only `LEGACY_MDB_EXPORT` source type, rejects empty source batches, and
  validates the freshest staged data inside the transaction. Duplicate
  test codes are still reported as warnings; validation does not approve
  financial, clinical or result release policy.
- Revalidation updates only unprocessed rows, with optimistic
  `updatedAt` claims on *both* the batch and each individual source row.
  A concurrent row import, skipped state, or changed row revision rolls
  back the entire operation. Imported/failed batches and processed source
  links remain immutable, with audit evidence only on success.
- Added pure regression tests for transaction ordering, owner fence and
  conditional role requirements; disposable two-session MariaDB tests
  verify live permission/branch/tenant revocations, same-tenant
  serialization, creator isolation and optimistic row/batch claim
  integrity. Mandatory CI includes both suites.

## Explicit acceptance boundaries

§88 original MDB row-level, checksum and migration lineage reconciliation
are not independently certified by this work. §87 spreadsheet/signed-bundle
review does not imply production activation. §75 clinical rules and §86
tax/currency policy require qualified human signoff. Issue #250 remains
NO_GO for clinical/financial/analyzer/restore acceptance; Issue #265
private-staging rendered UI review is NOT_EXECUTED. No clinical history,
released reports, actual patient/MDB values or credentials were changed
or committed to the public repository.
