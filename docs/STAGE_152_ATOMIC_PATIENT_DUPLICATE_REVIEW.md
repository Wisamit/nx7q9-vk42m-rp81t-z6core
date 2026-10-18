# Stage 152 — Atomic duplicate-patient review in the central registry

## Confirmed race
Stage 151 protects repeated **same-key** registrations but did not serialize two independent creation requests. The former `POST /api/patients` candidate search happened before `prisma.$transaction`, so two staff sessions or different request keys could each observe no patient and create separate organization-wide identities with the same normalized name/date of birth or phone. It also trusted a duplicate-review reason that was not tied to the candidate IDs the staff member actually reviewed.

## Changes
- The first operation in the patient-creation transaction takes a row lock (`SELECT ... FROM organizations WHERE id = ? AND status='ACTIVE' FOR UPDATE`). Registration writers for **one organization** serialize; different organizations do not share a lock.
- Under that lock, reread candidate identities in the current database state, before creating patient/identifiers/audit. A new potential match returns `possible_duplicates`, without creating a patient. No heuristic hard-unique index on name/date of birth (different people may legitimately share these).
- Preserve Stage151 exact-key retry by checking previously keyed registrations **again inside the lock** before the new duplicate search. Same key and hash returns the existing identity without a second audit or patient; changed intent or merged/inactive identity fails closed.
- Bind a deliberate `duplicateReviewOverride` to the exact candidate IDs previously displayed and explicitly reviewed. Fresh candidates or disappearance of reviewed identities returns `duplicate_review_candidates_changed` and requires a new review. Candidates are UUID-validated, unique and bounded.
- Refuse review lists exceeding ten matching active identities instead of silently truncating an overflow (manual reconciliation required).
- Recheck standard and custom identifier uniqueness inside the lock; preserve MariaDB unique constraints as the last line of defense.
- UI submits reviewed candidate IDs and bilingual stale-review warning. Prior Stage151 lost-response safety and original create/override audit events remain.
- No patient record history rewrite, clinical policy inference, schema migration, billing changes, automatic merge or release action.

## Verification
- Pure tests enforce exact candidate acknowledgement, UUID validation, ordered lock-before-fresh-search-before-write, locked replay and distinct reason handling.
- Two-session MariaDB test uses one held organization lock and a second connection's lock timeout to prove serialization. A different organization remains independently lockable. After release, the second transaction reads the first patient's new demographic evidence and rejects stale review.
- Existing end-to-end static/audit tests, full safety suite, Prisma migration status, TS, ESLint, MariaDB integration, bilingual/RTL/theme checks and production build gate merging.
- Software and qualified clinical signoffs remain distinct: Issue #265 remains OPEN/NOT_EXECUTED; Issue #250 remains OPEN/NO_GO. Stage151 deployed on Hostinger at owner-confirmed `a3fe551d`; Stage152 must not be treated as deployed until the owner confirms its own new merge SHA.
