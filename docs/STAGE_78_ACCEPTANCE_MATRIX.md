# Stage 78 — Critical Result Communication Concurrency & Audit Safety

## Baseline and verified risk
- Baseline SHA `bf6ae28407e34f744ba9de303df587c08982e09c`, Stage 77 merged CI #1053 SUCCESS and owner-confirmed Hostinger deployment.
- Master Scope §12 requires critical-result acknowledgement, read-back policies, notification/communication record and escalation traceability; §§39–42 require reproducible clinical state and audit.
- The `POST /api/results/[id]/critical-communications` route previously read an event and its eligibility before its transaction, then always inserted a communication record. For ACKNOWLEDGED and ESCALATED outcomes it used unconditional event updates; all other outcomes inserted records without a state change. Two operators holding the same old view could race, overwrite acknowledgement, double-escalate, or record a phone attempt against an already closed event.

## Implementation
1. Add `src/lib/critical-communication-claim.ts`: before any communication or audit row, atomically `updateMany` only the matching event `id`, `resultId`, `status: OPEN`, original escalation level and original `updatedAt`. Recheck parent laboratory-result organization, performing branch and eligible status in the same conditional write.
2. Use a **strictly monotonic** `updatedAt` stamp (at least 1ms higher than observed) for *all* outcomes, including NO_ANSWER, LEFT_MESSAGE and FAILED. This implements conflict detection for otherwise no-op calls, even if attempts occur in the same DB clock millisecond.
3. ACKNOWLEDGED conditionally closes the event, records acknowledged timestamp and communicating user, and clears the due date. ESCALATED increments the level rather than assigning an old calculated value. Existing max escalation and read-back checks still apply; old policy snapshots and recipient data remain immutable.
4. The claim, communication insert and audit insert all run in **one transaction**. A failed claim creates neither communication nor audit and responds with HTTP **409** `critical_event_state_changed_reload`. A non-open event is immediately rejected with HTTP 409.
5. No relaxed branch/department permissions, no silent overwrite, no changes to released results, no modification of existing historical communication records.

## Automated evidence
- `tests/stage-78-critical-communication-claim.test.ts`: real helper invocation using a controlled updateMany stub checks conditional source/result/version/tenant/branch eligibility, monotonic stamp, all five outcomes, and route transaction ordering.
- `tests/stage-78-critical-communication-concurrency-mariadb.integration.test.ts`: two MariaDB operator connections race the same event for ACKNOWLEDGED versus ESCALATED, enforce exactly one atomic winner, suppress stale NO_ANSWER/ESCALATED submissions, ensure one acknowledgement only and communication/audit counts match; revoke parent laboratory result eligibility and confirm stale event cannot be claimed.
- Integration suite explicitly wired to CI; all existing safety/MariaDB suites, Prisma migration checks, typecheck, lint, Arabic/English UI checks and Next production build remain mandatory.

## Deployment and limitations
- No migration, additional environment variable, or backfill.
- A rejected racing attempt **must be refreshed and re-entered** by the authorized user, preserving accurate clinical attribution. This protects the persisted application event and audit, not against an external phone call that physically happened but was not recorded; operational communication procedures still apply.
- Manual staff/clinical/provider UAT remains deferred and is **not** considered passed.
- PR #128 Analyzer Bridge stays OPEN/DRAFT; no changes to it.
- Hostinger publication requires separate owner confirmation after verified main CI.
