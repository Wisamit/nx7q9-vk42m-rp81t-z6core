# Catalog export disclosure — live role, branch and department authorization

## Verified source-level defects

Both GET configuration export endpoints check session permissions at request
entry. However the paged JSON route then reads and audits source records
without a transaction-time authority check, while the signed atomic bundle
checks live branch and department grants but did not recheck catalog, pricing,
or clinical-range permissions against current ACTIVE role assignments. An
in-flight request can therefore disclose configuration evidence after a role
or permission is revoked, even when its earlier session still holds the
grant. Source export can include exact prices, clinical reference limits,
equipment parameters and method configuration; DRAFT-only import does not
make export disclosure harmless.

The paged route also derived simple TEST and COMPONENT test scopes from
organization and optionally department grants without an explicit
performing-branch condition; its composite route used the stronger
clinical scope. All ten paged export types must enforce the same branch
boundary as their atomic signed bundle counterparts.

## Fix

- Reuse the unified current-DB authorizer from controlled CSV/XLSX staging:
  ACTIVE actor and tenant, current same-tenant ACTIVE role grants for
  catalog.manage and conditional pricing.manage /
  catalog.reference_ranges.manage, intersection of initially and currently
  granted ACTIVE branches, and safe narrowing/revocation of departments.
  Each role may contribute separate rights to a mixed export.
- The paged GET now acquires an ACTIVE tenant FOR UPDATE lock, performs the
  reauthorization, reads at RepeatableRead isolation and logs the export
  inside the same database transaction. Fail closed before all master
  reads if privileges were revoked. Every TEST, COMPONENT, price item,
  reference interval and composite uses the clinical branch-aware test
  where predicate, preventing visibility into other performing branches.
- The signed bundle GET now uses that **same** current-role authorizer
  immediately after its existing ACTIVE-tenant lock and before reading or
  signing any source rows. It preserves its atomic snapshot and existing
  server-side attestation; no historical master or signed report changes.
- Both routes preserve the shared generic price list exclusion for
  source/referrer/client/contract tariffs. Paged exports still explicitly
  identify themselves as paged-live-not-atomic; the signed bundle retains
  transactional-consistent-read and exact decimal evidence. Rechecking
  identity does not authorize new approvals, edits, or imports.
- Pure/source regression validates query coverage, ordering and separate
  pricing/clinical grants. MariaDB two-connection synthetic regression
  checks the tenant lock, revocations, denied cross-branch clinical tests
  and source availability. Full CI now includes the integration test.

## Explicit qualifications

This is a software-level access/disclosure control, **not** full §87
round-trip or activation approval, not actual MDB source parity (§88), and
not a clinical or financial policy decision (§75 / §86). Issue #265 still
requires private synthetic browser validation of all views, and #250
requires qualified clinical/finance/device/DR acceptance; GO/NO_GO remains
NO_GO. No actual patient, medical, contract or credential data are
included in this public repository change.
