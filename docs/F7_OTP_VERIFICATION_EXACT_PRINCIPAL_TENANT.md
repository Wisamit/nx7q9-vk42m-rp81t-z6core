# F7 OTP verification — exact linked principal and tenant recheck

## Security problem

The contact OTP verifier compared the code using bcrypt and then checked
an active linked patient/client/referrer. However the post-bcrypt query
did not confirm the organization was still ACTIVE, that the account type
remained the same, or that the linked patient/client/physician was the
*same identity* loaded before bcrypt. A switched account linked to another
active patient could otherwise consume a challenge issued to the previous
identity. A tenant deactivated during bcrypt could also pass.

## Correction

The verifier now joins the ACTIVE organization inside its transaction.
The lock query also compares the current account type with the session's
original type, and compares patientId / clientId / referrerId against the
originally loaded linked ID while checking ACTIVE state, PHYSICIAN type for
doctor, and matching organization for all types.

If any check fails, the transaction fails closed with the existing generic
portal_unauthorized response and does not claim OTP, produce contact proof,
change account timestamps or write a success audit event.

## Evidence

A new mandatory GitHub Actions step runs against real MariaDB with two
connections: a valid patient A challenge, a switch to another ACTIVE
patient B, a disabled organization, and an account type change. Each
must deny the old challenge without consuming it. The unchanged
live principal is the only scenario allowed to consume it.

Source-level regression tests protect exact linked ID, ACTIVE tenant,
post-bcrypt ordering, existing session guard, audit and idempotency gates.

This is synthetic engineering evidence, **not** a live clinical or privacy
certification, verified Hostinger deployment or F8 signoff. F7 486 private
browser cases and F8 88 qualified cases with seven signoffs remain
NOT_EXECUTED / NO_GO. Preserve all 88 Master Scope sections.
