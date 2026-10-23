# F7 — portal password changes cannot reactivate a disabled account

## Verified source defect

`POST /api/portal/auth/change-password` read a live portal cookie,
hashed a new password, then called `portalAccount.update` with
`status:"ACTIVE"` without locking or rechecking the current account
status. Administrative disable or session revocation could occur between
that cookie read and the mutation; a stale request would reactivate a
disabled account. Other concurrently logged-in sessions remained usable
after a password change, increasing stolen-token persistence risk.

## Correction

The route now uses one serializable transaction:
1. Lock the same-organization portal account row with SELECT ... FOR UPDATE.
2. Require its current status still be ACTIVE.
3. Require the exact initiating session still unrevoked and unexpired.
4. Change the password only if the account is still ACTIVE; **never update
   its status to ACTIVE** as a side effect.
5. Revoke all other active portal sessions atomically; retain the initiating
   session so the existing first-login form can redirect to /portal.
6. Audit PORTAL_PASSWORD_CHANGED with the number of other sessions revoked
   but no password, token, email or patient payload.

The generic 401 response rejects accounts or sessions changed while the
password hash was computed. Real database or unexpected errors are not
silently translated into success.

## Tests

Deterministic source-safety tests enforce parent-row locking, session
expiry/revocation checks, absence of status reactivation and atomic audit.
An explicit GitHub CI MariaDB test uses two independent connections to
verify row-lock serialization against a concurrent account disable and
confirmed revocation of other tokens, without revoking the current session.
It also confirms a disabled account cannot be mutated through the
active-account update predicate.

No schema migration, patient record, specimen, invoice, released result,
report history or privacy preference is overwritten by this increment.

## Deferred, not passed

F7 private browser matrix 81 routes × 6 contexts = 486: NOT_EXECUTED.
F8 qualified clinical, finance, devices, DR and owner evidence / 88
sections / seven signoffs: NOT_EXECUTED and NO_GO.
Hostinger release SHA is not attested. Master Scope §§1–88 unchanged.
