# F7 — OTP issuance: recheck live principal, organization and session

## Race closed

Contact-verification OTP requests were already serialized using an exclusive
lock on the portal account and were rate limited. However, the route checked
the linked patient/client/physician, active organization and portal session
**before** generating and bcrypt-hashing a new code. That expensive work
leaves a window in which the associated identity, tenant or session can be
revoked. The old issuance transaction rechecked only the account status,
must-change-password flag and destination before enqueuing an OTP.

## Implementation

Within the same MariaDB transaction, before replacing any existing code or
writing a notification, the route now:

1. Locks the current active account and verifies its destination.
2. Revalidates an ACTIVE organization, exact live linked PATIENT, CORPORATE
   client or PHYSICIAN, matching the original linked identifier and tenant.
3. Locks and rechecks the issuing session: exact session/account, not revoked
   and not expired.

Each check fails closed before changing challenges, notifications or audit.
A revoked session produces generic `portal_unauthorized` (401), while
changes to the linked subject or organization produce
`portal_subject_changed` (409). Existing rate limits, serial OTP
replacement, single-use/attempt CAS and masked responses remain intact.

## Evidence and scope

A source guard-order regression proves that all live-identity and session
checks run before replacement, creation and notification. A new required
two-connection **real MariaDB** test covers deactivated patient,
deactivated organization, revoked/expired session and mismatched linked ID,
and confirms denied attempts create no extra challenges.

No schema migration, patient or billing alteration, report amendment,
analyzer operation or clinical signoff is involved. F7 rendered private
81-route × six-context UAT remains NOT_EXECUTED/DEFERRED. F8 all 88
qualified cases and seven independent approvals remain NOT_EXECUTED/NO_GO,
with Hostinger deployed SHA and real devices unverified. Preserve the
complete Master Scope §§1–88.
