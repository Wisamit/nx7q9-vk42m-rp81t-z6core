# F7 — live patient, corporate client and physician principal during portal login

## Problem
The portal login POST correctly checks tenant-scoped unique email/phone ownership
after a potentially slow bcrypt comparison. It previously did **not** recheck
whether the portal account's originally linked Patient, corporate Client or
physician Referrer remained ACTIVE, correctly typed and in the same
organization at that point.

A still-active portal account could consequently create a fresh session for a
disabled/merged/foreign linked clinical principal. Its other guarded pages
would subsequently deny content, but this would still create an invalid
session and success audit. The incorrect-password path could also increment
failed-login attempts or apply a lockout to a revoked principal.

## Correction
Both post-bcrypt login transactions already lock the same portal account
row and independently verify unique contact ownership. They now additionally
require a live linked principal before **any** session, failed-attempt
mutation or audit event:

- Patient account: matching Patient ID, ACTIVE Patient, same organization
- Corporate account: matching Client ID, ACTIVE Client, same organization
- Doctor account: matching Referrer ID, ACTIVE PHYSICIAN, same organization
- Account type must match the earlier authenticated candidate
- Organization must remain ACTIVE; account status must be ACTIVE or the
  previously supported LOCKED state subject to existing expiry checks

This prevents stale pre-hash links from silently being replaced with another
active subject. Invalid principals receive the existing generic login
failure. The existing exact-contact uniqueness, lockout, session cookie
policy, audit, and MariaDB transactional safeguards remain intact.

## Evidence
A deterministic test checks both bcrypt branches and that revalidation
precedes side effects. A separate explicit CI step opens real MariaDB
connections and proves that deactivating the patient or organization,
changing the linked patient since the pre-hash snapshot, and a failed
login for a revoked patient leave sessions and lockout counters unchanged.

No database migration, patient order, specimen, released clinical result,
financial history or branch scope is rewritten.

This is software verification, not medical/financial/privacy signoff.
F7 protected 81 x 6 browser UAT remains deferred; F8 qualified 88-case
real-world testing and seven approvals remain NOT_EXECUTED/NO_GO. Actual
Hostinger deploy, analyzer interoperability and restore verification remain
independent gates. All sections 1–88 of Master Scope stay in force.
