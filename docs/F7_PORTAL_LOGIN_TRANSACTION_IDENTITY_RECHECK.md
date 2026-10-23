# F7 portal login — recheck current contact ownership at credential commit

## Source defect

Portal login initially resolves exactly one normalizedEmail/normalizedPhone
under the requested active tenant, then performs potentially expensive bcrypt.
The subsequent successful-session transaction locked the chosen account and
rechecked the password hash and status, but did **not** recheck that the
original login contact still belongs exclusively to that account.

A concurrent account/contact rotation during bcrypt could therefore create
a portal session against an identifier that the user no longer controls.
The wrong-password transaction could similarly increment lockout attempts
against an account no longer matched by that identifier.

## Correction

In both the failed and successful password paths, under the existing
Serializable MariaDB transaction and portal-account row lock, re-read:
- the current tenant's ACTIVE status;
- the account's current normalizedEmail / normalizedPhone;
- at most two current matches of that submitted identifier, scoped to
  the account's exact organization.

Only a single candidate equal to the locked account with a current matching
contact is acceptable. Revoked/rotated, duplicated, reassigned or inactive
tenant cases abort before failed-login audit, lockout mutation, portal session
creation or successful-login audit, returning generic invalid_credentials.

The transaction and row locks remain in the existing login path, with no
schema migration, no alteration to preexisting accounts, no report/result
history mutation and no change to account password semantics.

## Verification

Pure negative tests cover single/duplicate/zero/wrong match and current
email/phone ownership. Source regressions require this recheck in **both**
transaction paths before audit/session writes. GitHub CI runs a separate
**real MariaDB** test using two connections to simulate contact transfer and
tenant deactivation during the delay between initial lookup and locked
credential commit, then verifies the guarded behavior fails closed.

This is engineering validation; it does not prove live login browser UAT,
third-party identity proof or complete authorization signoff.

F7 81 routes x six contexts = 486 private rendered UAT combinations remain
NOT_EXECUTED; F8 88 qualified acceptance cases and seven external signatures
remain NOT_EXECUTED / NO_GO. Master Scope §§1–88 remains unchanged.
