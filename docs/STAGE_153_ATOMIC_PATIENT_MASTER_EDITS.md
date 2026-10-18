# Stage 153 — Atomic central patient master edit / registration identity checks

## Confirmed cross-workflow safety gap
Stage 152 serialized new patient registrations inside an active organization `FOR UPDATE` row lock and bound duplicate-review override to exact candidate UUIDs. However `PATCH /api/patients/[id]` still ran its independent candidate search **before** its update transaction. A registration and a master-name/DOB/phone edit, or two independent edits, could both see an outdated identity population and proceed without reviewing the new collision.

## Delivered scope
- `PATCH /api/patients/[id]` takes the **same ACTIVE organization row write lock** as `POST /api/patients` at the beginning of its transaction. Re-reads the edited patient's status/merge/version and all potential duplicate identities under that lock before any master or audit write.
- Preserves existing optimistic compare-and-swap `updatedAt: expectedUpdatedAt` for concurrent updates, immutable released report snapshots, required change reason, audit event `PATIENT_UPDATED`, and separately reasoned `PATIENT_DUPLICATE_REVIEW_OVERRIDE`.
- Reuses Stage152's exact-candidate UUID acknowledgements and ten-row fail-closed overflow policy. An override is only authorized when it references **all and only** currently matched active patient identities. A match disappearing or appearing while editing is a 409 requiring fresh review; no write or audit mutation occurs.
- AR/EN patient edit modal submits reviewed candidate IDs, clears stale review state on 409, and directs staff to the central registry for fresh comparison.
- No schema migration, no alteration of historical clinical results or prices, no heuristic unique key on name+DOB, no automatic patient merge and no broadened permissions.
- **Explicit boundary:** this serializes current first-party new-patient and master-edit flows. Direct database mutations and any other identity-changing workflow must use the same lock or their own verified collision control; this is not blanket proof that any arbitrary external writer cannot create a duplicate. Existing identifier uniqueness remains DB-enforced.

## Regression evidence
- Source/safety guards assert tenant lock -> live patient/version -> fresh duplicate search -> review identity acknowledgement -> optimistic CAS update -> immutable audit ordering.
- Real two-connection MariaDB tests prove that a registration holding the tenant lock excludes edits and vice versa, while a separate tenant stays independently lockable. After release, the second transaction sees the newly updated identity and cannot treat a stale candidate list as valid.
- CI retains full Prisma migrations/status/generate, TS, lint, full safety, all MariaDB clinical/billing/integration suites, AR/EN/RTL/theme and production build. Only merge on exact feature SHA success and revalidate the final main merge SHA independently.

## Outstanding gates
Issue #265: 81-route full interactive visual and keyboard UX audit remains OPEN / NOT_EXECUTED. Issue #250: qualified clinical, finance, analyzer, host backup/restore and UAT GO/NO-GO remains OPEN / NO_GO. No UAT or Hostinger success is inferred from GitHub CI. Owner-confirmed prior deployed main SHA `e7f581d4`. No Master Scope section removed.
