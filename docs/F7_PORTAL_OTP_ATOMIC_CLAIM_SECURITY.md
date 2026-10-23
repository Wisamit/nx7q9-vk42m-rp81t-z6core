# F7 — atomic portal contact OTP claims and retry budget

## Security defect

The contact verification endpoint loaded `attempts`, `expiresAt` and
`consumedAt` before bcrypt verification. Previously an incorrect code used
an unconditional update by ID and a correct code consumed the challenge with
only `consumedAt: null` in its update predicate. Two overlapping requests
could therefore spend more attempts than `maxAttempts`, or a request could
consume the challenge after expiration or exhaustion while bcrypt ran.

This is an actual race in server-side security enforcement, not just a UI
validation weakness.

## Software correction

Both wrong-code accounting and correct-code claim now execute `updateMany`
with one shared `portalOtpAttemptGuard` including: challenge ID, portal
account, purpose, stored code hash and destination, `consumedAt: null`,
`expiresAt > current claim time` and `attempts < maxAttempts`.

- Wrong guesses atomically increment within the budget only; a competing
  consumed, exhausted, expired or rotated challenge gets a generic 409.
- Correct codes atomically consume once inside the existing transaction;
  a raced-out claim rolls back and cannot create a verification record,
  delivery side effect or `PORTAL_CONTACT_VERIFIED` audit event.
- The OTP hash comparison and user-supplied data still happen before the
  successful transaction, but never grant permission without the database
  conditional update.
- Contact destinations and PII are never written to the test fixture
  beyond synthetically generated `example.invalid` data.
- No schema migration, patient data or released medical/financial history
  mutation.

## Test evidence and limitations

Deterministic tests enforce CAS predicates in both code branches. An
explicitly wired GitHub Actions test opens two **real MariaDB connections**
and verifies: a 1-attempt challenge accepts only one concurrent wrong guess,
an exhausted challenge cannot be consumed successfully, two simultaneous
successes consume once, a consumed challenge ignores further attempts, and
expired or stale-hash challenges cannot be claimed.

This is still *engineering verification*, not clinical use approval,
protected browser test completion, real SMS/email provider delivery, or
a penetration test.

F7 81 routes × 6 contexts remain private UAT_DEFERRED / NOT_EXECUTED; F8
88 qualified real-world cases and seven signoffs remain NOT_EXECUTED / NO_GO.
Master Scope §§1–88 is preserved in full.
