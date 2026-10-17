# Transaction-time clinical legacy import authorization

## Verified defect

Three legacy import write routes used the clinical user's active branch and
department scopes collected at request/session start, but did not read current
live permissions before mutating catalog or clinical draft data:

- `prepare-units` creates ACTIVE units and conditionally assigns default
  units to imported tests. Its transaction only checked the branch's ACTIVE
  status, not current user/role/branch/department grant revocation.
- `reference-ranges` can create INACTIVE components and DRAFT, INACTIVE
  reference intervals after a pre-transaction preview. It rechecked a test
  against the potentially stale session scope, without validating live
  authorization or current ACTIVE unit identity inside the transaction.
- `mappings` can upsert organization-wide test/unit alias mappings using
  targets read before its transaction; a revoked actor or an inactive unit
  could still reach the upsert.

## Implemented boundary

A shared `liveLegacyClinicalWriteScope` is executed after the ACTIVE
organization's `FOR UPDATE` serialization lock and before any write.

It checks the actor remains ACTIVE in the same ACTIVE organization, the
required `catalog.reference_ranges.manage` permission is still granted
through an ACTIVE same-tenant role, and the exact target branch is ACTIVE
and currently granted. The original session's branch grants remain a
separate upper bound.

Live department grants intersect with those present when the request
started. A restricted session whose authorization is revoked cannot become
unrestricted; a formerly unrestricted session that has since been
restricted is limited to the current active departments. Inactive,
foreign-tenant, foreign-branch, newly granted unrelated department rows
do not widen existing request scope.

The unit preparation path uses this live scope for every test lookup and
conditional update; the interval path also checks the source batch remains
an actual legacy import and the selected unit is currently ACTIVE in the
same tenant. The alias path also rechecks current test or active unit
identities under the live authorization before any upsert.

All three mutations retain existing audit logs, historical immutability,
and the INACTIVE/DRAFT clinical review requirement. Authorization failures
roll back without marking source rows imported or modifying any masters.

## Regression coverage

- Pure tests verify current role+branch+user query, department intersection
  including revocation and new restrictions, and all three route
  ordering guarantees.
- Synthetic two-connection MariaDB tests verify CURRENT role, branch, user,
  organization and department grant changes plus the tenant serialization
  barrier, with no patient or original MDB data. Dedicated MariaDB CI gate.
- Existing stage 31 and 45 source assertions remain part of the full safety
  test suite, updated for the tighter live scope.

## Limitations and release gates

This is **not** proof of exact legacy MDB row-level parity. Organization-wide
alias mapping remains a shared catalog business rule; this change does not
authorize cross-branch clinical configuration changes or overwrite released
reports. Further source-policy review and qualified clinical experts are
required for activation. §75 clinical/device policies, §86 tax/currency
accounting jurisdiction rules, §87 governed spreadsheet activation, and
§88 source-row signoff remain open. Issue #250 GO/NO_GO = NO_GO;
Issue #265 rendered private staging browser walkthrough is NOT_EXECUTED.
