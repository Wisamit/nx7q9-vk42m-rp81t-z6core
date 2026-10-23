# F7 — Portal booking principal linkage guard

## Defect and impact

The patient portal appointment POST previously initialized its target using
`account.patientId || requestedPatientId`. A still-authenticated PATIENT
portal account whose patient linkage had become null could therefore accept
an arbitrary caller-supplied patient UUID as its appointment target. Similarly,
a CORPORATE account relied on a non-null assertion for the client relationship
and did not first confirm that the linked client was active and part of the
portal account's own tenant. These are unsafe multi-tenant identity assumptions.

## Correction

Before reading user-supplied appointment data or entering an appointment
transaction, resolve the active linked principal on the already authenticated
portal session:

- PATIENT must have a linked ACTIVE Patient whose ID and organization ID match
  the portal account's linkage and tenant. Its booking target is that linked
  patient, never a request-supplied fallback.
- CORPORATE must have a linked ACTIVE Client matching the account's client ID
  and organization ID. Per-patient `canBook` grant checks (active,
  effective-dated) remain mandatory, as do the requested patient's ACTIVE
  same-organization checks.
- DOCTOR continues to be forbidden to book through this endpoint and any
  unknown/invalid account type fails closed.
- A missing/revoked/foreign linkage produces the existing generic
  `portal_unauthorized` 401 response, without exposing other tenant IDs.

This is independent of the existing submitted-UUID / MariaDB uniqueness
protection. No clinical order, patient, specimen, financial record, report
version, schema or previously released result is mutated by this increment.

Focused automated tests exercise missing or changed linked patients, merged/
inactive patients, inactive/missing/foreign clients, disallowed account types
and actual API guard order. Existing CI performs the two-connection MariaDB
idempotency test separately. These tests are engineering evidence only.

## Explicitly deferred

F7 private browser/RTL/accessibility test matrix: 81 routes x six contexts,
NOT_EXECUTED. F8 qualified real-world 88-section UAT / seven signoffs and
Hostinger/device/DR/clinical acceptance: NOT_EXECUTED / NO_GO. Master Scope
sections 1–88 remain intact.
