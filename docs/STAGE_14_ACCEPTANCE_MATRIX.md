# Stage 14 — Portals & Digital Services Safety / Acceptance

**Base:** `main` `71ecef4513f68120cdf8788a9a0154fa54addfbf`, Stage 13 CI #851 success; owner confirmed Hostinger deployment.  
**Authority:** `02_MASTER_SCOPE.md`, chapters 45–48 and related booking/home collection/queue requirements from `07_IMPLEMENTATION_ROADMAP.md` Phase 15. No intentional scope reductions.

## Reused modules

Patient / doctor / corporate portal and identity, controlled report versions and delivery log, contact verification, branch-scoped appointments, home collection visits, reception/phlebotomy queues, privacy-safe public queue display, AR/EN/RTL/LTR.

## Stage 14 code changes

| Workflow | Integrity control |
|---|---|
| Appointment status | Serializable lock on appointment row; state + revision claim; audit in transaction; reject cancellation after sample collection has begun or completion before delivery |
| Home collection | Lock appointment first, then visit status; reject updates to cancelled/no-show appointments, stale visit changes and specimen custody cancellation after collection starts; deliver only when appointment is valid |
| Queue issue | Lock linked appointment against simultaneous cancellation/check-in; reject invalid appointment status; retry only actual uniqueness/serialization conflicts |
| Queue progression | Optimistic transition on status+updatedAt, audit only committed transition |
| Corporate portal list | Corporate appointment history scoped to originating portal account, even when same patient participates under another client; booking select lists only current `canBook` grants |
| Portal login/disable | Both acquire the account row lock; changed password/disabled/temporarily locked state rechecked under lock before creating session; disable revokes all sessions atomically |
| MariaDB | Two-connection integration test for cancellation, queue CAS, session revocation/disable lock, plus source regression tests run in CI |

## Release gate

- [ ] Feature-branch exact SHA: MariaDB migrations and all integration tests, safety, TypeScript, ESLint, RTL/English UI and production build SUCCESS.
- [ ] PR approved for merge and merged with expected feature-head SHA.
- [ ] Main exact merge SHA CI SUCCESS.
- [ ] Hostinger deployment confirmed separately by owner.
- [ ] Real portal login/provider delivery, operational booking, specimen-handling and end-user UAT **DEFERRED** until entire LIS scope is complete.

**Boundaries:** Passing CI verifies code and transaction behavior, not production device workflows or customer consent/authorization policies. External clinical e-ordering, corporate contract rules, booking-slot capacity, communications provider and future app features remain subject to the full Master Scope; none are removed by the focused safety increment. Analyzer Bridge PR #128 remains independently Draft/unmerged.
