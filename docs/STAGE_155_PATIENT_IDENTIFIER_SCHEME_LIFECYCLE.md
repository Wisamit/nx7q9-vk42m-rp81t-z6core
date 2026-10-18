# Stage 155 — Patient identifier scheme deactivation vs registration

## Source-confirmed race
Stage 154 synchronized patient create, master edit, identifier add/deactivation and patient merge through a common ACTIVE organization row lock. However identifier scheme PATCH deactivation still read the scheme state before its own transaction and never acquired the shared lock. Patient POST registration evaluated scheme availability before the organization lock and did not revalidate it before adding identifiers. This allowed a queued patient creation to use a custom identifier scheme that had been deactivated by a concurrent administrator, creating a new active identifier under an inactive scheme.

## Implemented boundary
- Organization-scoped POST/PATCH identifier scheme governance acquires the exact same `SELECT ... organizations ... FOR UPDATE` active-tenant lock as all first-party patient identity operations before creating or reading/retiring schemes. Existing soft-deactivation, reserved standard schemes, authorization and audited reasons remain intact.
- After the lock and Stage151 replay decision, patient POST rereads all selected scheme IDs as **ACTIVE within the same registration transaction**. It verifies ID, code, identifier type and required issuing-country status against current values. Any scheme deactivated or altered in the interval fails closed `identifier_scheme_changed` 409, without creating a patient, identifier or audit event.
- A request that initially finds an inactive scheme continues to return existing preflight errors. The existing duplicate-review workflow, request-key idempotency and organization/branch audit context remain unchanged.
- Staff create form shows bilingual stale-scheme guidance and clears the obsolete duplicate review state. Staff refresh and choose an active scheme rather than blindly retrying.
- A scheme can be disabled even if it has historical references; historical patient identifier rows, their original normalized values, and the global tenant-specific uniqueness are **not deleted, reassigned, or recycled**.
- No schema migration, no permission changes, no automatic patient merge, no alterations to issued reports, test definitions, prices or analyzer policy.

## Real MariaDB test and limitations
- Two physically separate DB sessions verify: (1) deactivation holds lock, a queued registrar waits, then rechecks and finds the scheme inactive; (2) a registrar holds the lock while committing a new identifier, and the administrator can deactivate the scheme only afterward. Different organizations do not share row locks, historical identifier FK survives deactivation and inactive identifier key cannot be reused.
- Automated source checks require locked scheme governance and live in-transaction registration revalidation. CI still runs Prisma, TypeScript, ESLint, safety, full MariaDB suites and production Next build.
- External tools writing directly to the database without this lock remain outside the first-party guarantee and require integration-specific safeguards.
- Owner-confirmed Hostinger deployed Stage154 `0b6c69dc`. Stage155 must not be claimed deployed until its final main CI passes and the owner independently confirms Hostinger success.
- Master Scope untouched. Issue #265 (81-route interactive visual/UX acceptance) remains OPEN/NOT_EXECUTED; Issue #250 (clinical/device/financial/restore qualified UAT final GO/NO_GO) remains OPEN/NO_GO.
