# Stage 151 — Patient registration lost-response replay safety

## Source-confirmed clinical identity gap
Before Stage 151, `POST /api/patients` can commit patient/identifiers/audit atomically, but a lost HTTP response returns a warning to search the patient list manually. A repeated request has no durable unique operation identity and can create an additional patient without stable National ID/Passport, particularly if neither DOB nor phone matches an existing duplicate candidate. Cross-branch patients remain organization-wide, so this risk affects the entire LIS.

## Implemented boundary
- Browser generates one `crypto.randomUUID()` per attempted registration, sends it in `x-family-lab-patient-key` and retains that key after network/ambiguous 5xx failures. A successful confirmation resets it.
- MariaDB migration adds nullable `creation_request_user_id`, `creation_submission_key`, `creation_payload_hash` to `patients`, a composite unique constraint over organization/author/key, and a creator FK. Historical unkeyed patient records remain valid and are **not** rewritten.
- Server requires `patients.manage`, validates any supplied UUID, calculates a SHA-256 of canonical JSON intent without logging patient fields, and searches the **same organization and author** for a previous submission before looking for possible duplicate identities.
- Exact repeated payload and still-active unmerged patient returns a minimal already-existing patient receipt with `replayed:true`, no second patient, identifier or `PATIENT_CREATED` event; changed payload returns 409, and merged/deactivated historical identity returns a separate 409. Old registrations are never overwritten.
- Unique DB constraint resolves same-key concurrent submissions even if both cleared the early lookup; the failed transaction rechecks the original exact intent. No automatic merging, no inferred age, clinical ranges, thresholds or financial changes.
- `possible_duplicates` pre-commit response explicitly clears the key: any independently reviewed override is a NEW deliberate action with a new key and the existing audit reason. Valid non-commit 4xx responses may be retried after correcting input; ambiguous transport/server failure keeps the original key.
- Legacy integration clients without a key continue existing behavior; this guarantee covers **keyed** staff UI clients. A complete prevention of independently submitted different-key same-person registrations still requires the existing duplicate review workflow and qualified identity verification.

## Verification and release
- Safety tests: UUID validation; stable hash vs data/identifier/override changes; active/unmerged lookup; exact author+tenant query; replay-before-duplicate ordering; persisted migration and audit/identifier transaction.
- Real MariaDB: two sessions concurrently insert same key, exactly one succeeds; valid duplicates across different tenant/user scopes; legacy null coexistence; FK rejects unrecognized creator. Full TS/lint/Prisma migration status, safety, clinical/finance MariaDB suites, theme/i18n and production Next.js build required.
- Issue #265: comprehensive 81-route interactive/visual release gate remains OPEN / NOT_EXECUTED.
- Issue #250: 88-case qualified clinical, financial, device and Hostinger DR GO/NO-GO remains OPEN / NO_GO. Automated duplicate safety is **not** signed clinical identity UAT.
- Owner previously confirmed Hostinger deployment of `d79c992f`; this new stage is **not** considered deployed until owner explicitly confirms its merge SHA.
