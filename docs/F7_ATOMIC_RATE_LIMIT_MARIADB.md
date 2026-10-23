# F7 — atomic MariaDB rate-limit accounting

## Real issue

The shared checkRateLimit function used a pre-read windowStart comparison.
When several requests arrived exactly as the window rolled over, each could
read the old window and then unconditionally reset the count to 1. Parallel
requests could therefore consume a single rate-budget token multiple times,
allowing more OTP requests or portal login attempts than the configured limit.

## Correction

The handler now performs one SQL INSERT ... ON DUPLICATE KEY UPDATE on the
unique (scope,key_hash) row inside a database transaction:

- New row starts at count=1.
- Existing row atomically increments while the same window is active.
- On a newer window, its first arriving request resets count=1, and later
  concurrent arrivals increment from there.
- The database takes the later of the current window and the existing
  windowStart, preventing an older delayed request from moving the rate
  window backward.
- The claimed count is read under FOR UPDATE in the same transaction, so a
  concurrent request cannot steal or alter the decision before it returns.
- Existing allowed, remaining, Retry-After and SHA-256 hashed-key API behavior
  is preserved. No local-memory limit or shared-process assumption.

## Tests

Deterministic code regressions prohibit a return to findUnique/read-then-reset
logic. A new required CI test uses two physical MariaDB connections for 30
overlapping increments, proving 30 distinct budget claims, only five
permitted uses of a five-request budget, two separate rollover counts
1 and 2, and no delayed older-window rollback.

The same CI continues the appointment idempotency, OTP issuance, OTP
verification, linked-subject revocation and password-revocation regressions.

This is software and synthetic database verification. It does not constitute
a security penetration test, qualified clinical acceptance or production
deployment confirmation. Master Scope sections 1–88 unchanged.
F7 protected browser UAT 0/486 and F8 88 qualified cases/seven approvals
remain NOT_EXECUTED / NO_GO.
