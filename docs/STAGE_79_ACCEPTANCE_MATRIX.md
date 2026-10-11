# Stage 79 — Comprehensive Authorized Critical-Result Triage Queue

## Baseline and master-scope risk
- Baseline: Stage 78 SHA `3473df04470068c6f3568dcb9a5144b121385cb8`, independently validated main CI #1056 SUCCESS; Hostinger deployment confirmed by owner.
- Master Scope §12 mandates critical-result alerts, acknowledgement and communication logs, notified person, time/method, and escalation. Section 65 requires critical-result dashboard visibility; §2 insists strict branch and department scope.
- The critical-results page previously used `findMany({take:300})` with no pagination or overflow warning. More than 300 OPEN critical events could not be reached from the queue even though they required action.
- MariaDB ascending due-date ordering places `NULL` before due dates. Events without a governed due date could obscure overdue events when the queue was crowded.

## Delivered functionality
- Replace silent 300-row cap with **50 events + 1 sentinel** and stable keyset continuation using issue-specific immutable `id`, `detectedAt`, and nullable `acknowledgementDueAt`.
- Sort due dates ascending with **nulls LAST** (overdue first, upcoming second, no-policy last); break ties with `detectedAt` ascending and event `id` ascending for deterministic navigation.
- Add staff-visible **All Open / Overdue Only** filters, snapshot-consistent counts of authorized OPEN and overdue events, a "Next 50 events" link, and a "Back to first page" link.
- Cursor is base64url encoded, syntax/UUID/date-validated, bounded to 512 chars, and filter-bound. Invalid or outdated markers fail back to first page with explanatory bilingual warning. Cursor conveys a position only; **all queries and counts repeat tenant, active branch, department and OPEN state scopes**.
- Snapshot-consistent count/page reads execute in a `RepeatableRead` Prisma transaction with timeout and do not alter clinical data or policy.
- Existing bilingual clinical values, last communication, escalation level/due and authorized result action links remain intact.

## Automated acceptance
- `tests/stage-79-critical-results-queue.test.ts`: typed cursor roundtrips/rejections, independent nullable-due branches, stable keyset tie breaking, strict 50+1 sentinel, source-level tenant/active branch/department predicates, accurate warning, no silent limit.
- `tests/stage-79-critical-queue-cursor-mariadb.integration.test.ts`: two MariaDB sessions and synthetic >330 authorized OPEN critical events, overflow beyond previous cap, due versus no-policy priority, restricted same-tenant branch, foreign tenant and closed events, overdue filter and complete no-duplicate page traversal.
- Stage 79 MariaDB integration added as explicit CI gate alongside all existing tests, migrations, TypeScript, lint, Arabic/English UI and Next production build.

## Scope boundaries
- This is a **read-only critical triage worklist**. It does not automatically acknowledge results, increment escalation levels, contact clinicians, or activate unapproved clinical escalation policies. Stage 78's atomic clinician-recorded communication guards continue unchanged.
- No database migration, historical edits, financial actions or Hostinger environment variables.
- A later stage may add an approved-policy-driven critical escalation notifier with new audited durable idempotency; do not assume this stage sends alerts automatically.
- Cursor-based scans are consistent within each request, not a locked snapshot across a user's entire browser session. Changes between clicks can move an event; re-open the queue for current state.
- Manual clinical and provider UAT remains deferred until full LIS readiness; not claimed as passed. PR #128 Analyzer Bridge stays OPEN/DRAFT.
