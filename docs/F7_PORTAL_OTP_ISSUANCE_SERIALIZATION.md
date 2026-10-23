# F7 — per-account OTP issuance serialization

## Defect

Contact OTP issuance previously invalidated outstanding challenges and
created a replacement inside a Prisma transaction, but there was no row lock
ensuring that two simultaneous requests for the SAME portal account could
not both enumerate an empty/stale set of active challenges and each insert
its own still-valid OTP. Sending both would produce competing valid codes.

A pre-read session's email/phone snapshot could also become stale while the
transaction was waiting for database resources.

## Fix

The first statement inside the OTP issuance transaction now locks the
current portal account row using MariaDB SELECT ... FOR UPDATE with the exact
account ID and organization ID and status ACTIVE.

Before modifying challenges, it rechecks the account's current email/phone
destination and must_change_password status. If the account has changed,
issuance fails closed with a generic 409 portal_subject_changed; it does not
issue to an obsolete destination.

The per-account lock serializes both the revocation and new challenge
creation. The later requester observes and consumes the previously issued
challenge before creating its own. The latest code is the only usable code.

No new database table, schema change or business rule; existing notification
outbox enqueue, audit, rate limiter, masked response and OTP retry/expiry CAS
from the previous F7 increment remain intact.

## Verification

- New source-level test requires a parent-account FOR UPDATE and fresh
  destination checks BEFORE revocation/creation/notification.
- Separate mandatory GitHub CI test with two **real MariaDB connections**
  sends two synthetic simultaneous issuance transactions and verifies
  exactly one unconsumed challenge remains; it also verifies that a stale
  destination cannot issue another code.
- Existing MariaDB atomic verification and booking idempotency tests remain.

This verifies a concrete database serialization property, not live SMTP/SMS
delivery or a penetration test. F7 private browser UAT remains 0/486,
F8 qualified real-world UAT 0/88 with seven signoffs NOT_EXECUTED/NO_GO,
no independently confirmed Hostinger deploy. Master Scope 1–88 unchanged.
