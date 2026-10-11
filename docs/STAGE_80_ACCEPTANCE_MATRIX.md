# Stage 80 — Outbound Notification Worker Leases, Idempotency, and Crash Recovery

## Verified baseline and risk
- Stage 79 `main` SHA: `5e753332fc8f34f09dacc42802d6665443319025`, independent CI #1058 `SUCCESS`, Hostinger deployment confirmed by owner.
- The outbound EMAIL/SMS/WHATSAPP notification dispatcher had a per-attempt optimistic `attemptCount` claim but **did not persist an owner/token**. The attempt remained `PENDING`/`FAILED` with a temporary retry date. A provider request running past that date could be reclaimed by another worker and the original request could later overwrite the newer state.
- Master Scope requires traceable notifications, bounded retries, reliable delivery statuses, immutable report delivery and audit traceability across tenants.

## Implemented scope
- Migration `20261011180000_notification_dispatch_lease_fencing` adds `notification_deliveries.dispatch_token CHAR(36) NULL`, `dispatch_lease_until DATETIME(3) NULL` and a composite worker-scan index. Existing history remains valid; no update/backfill of released/financial data.
- Dispatcher selects only tenant-owned due EMAIL/SMS/WHATSAPP attempts whose lease is null or expired. It atomically claims the exact expected status, attemptCount, maxAttempts, due date and lease state, incrementing attempts and recording a unique UUID token with a 10-minute lease.
- On gateway success, failure, missing destination, missing gateway or obsolete/retracted signed report, all terminal/retry updates use **the same original UUID token and exact attempt number** in an independent transaction. Only the current owning worker can finalize. Report delivery state is updated **only when its notification claim finalizes**, preventing stale workers from rewriting clinical delivery status.
- Expired claims are recoverable. Exhausted `attemptCount >= maxAttempts` stays terminal `DEAD_LETTER`; retries cannot exceed the stored limit.
- A deterministic provider idempotency key `familylab-notification:<delivery_id>` is sent in the `Idempotency-Key` header and JSON body on **every retry** of that delivery. Stable deliveryId is also sent for gateway reconciliation.
- Retain existing tenant isolation, original report version revalidation, retry backoff, provider response parsing, provider reference and delivery/audit record semantics. No automatic activation of clinical policies, no reissued clinical history edits.

## Tests
- `tests/stage-80-notification-dispatch-lease-safety.test.ts`: source-level proof of CAS tenant scope, lease acquisition, fencing finalization, max attempt bound, existing report version revalidation, stable provider idempotency key and schema/migration shape.
- `tests/stage-80-notification-lease-mariadb.integration.test.ts`: real three-connection MariaDB: simultaneous claims, active lease exclusion, different organization denied, future retry protected, exhausted budget, artificial crash expiration, new worker recovery, old response cannot mark SENT, legitimate new finalization and no repeat send after SENT.
- Explicit Stage 80 MariaDB gate added to `.github/workflows/ci.yml`; all current safety, clinical/financial multi-branch MariaDB integration, Prisma migrate deploy/status, typecheck, lint, bilingual UI and Next production build remain required.

## Explicit safety limitation
**HTTP gateway acknowledgements are not exactly-once delivery guarantees.** If a gateway sent a message but did not answer, the LIS can only safely retry without physical duplicate messages when that gateway **honors** the stable `Idempotency-Key`. Third-party providers that ignore this header may send duplicates after a crash or 10-minute lease expiration. Before enabling live clinical outbound gateways, verify provider-specific idempotency and reconciliation behavior. The lease is to fence database workers, not a guarantee about physically delivered messages. Do not claim end-to-end vendor/device UAT has passed.

## Deployment
- **Prisma migration is REQUIRED** before/with Stage 80 deployment. Existing standard Hostinger build runs `prisma migrate deploy` before `prisma generate` and `next build`.
- No new environment variable; existing gateway configuration unchanged.
- Do not infer Hostinger deployment from successful GitHub CI. Owner separately confirms the exact final merged SHA.
- PR #128 Analyzer Bridge remains OPEN/DRAFT and must not be merged or activated.
