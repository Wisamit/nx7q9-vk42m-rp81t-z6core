# Stage 65 — Cursor-Paged Independent Policy Draft Review Queue

## Goal
Replace the Stage 64 terminal error at 101 qualifying AuditEvents with safe, bounded deterministic **keyset pagination**. A reviewer must be able to navigate older eligible drafts without resurrecting superseded revisions or bypassing present branch, department, domain or whole-batch checks.

## Delivered
- `src/lib/catalog-policy-queue-pagination.ts`: canonical, bounded, opaque Base64URL positional cursor for `(occurredAt DESC, id DESC)` with strict date/UUID/shape validation and deterministic next-page computation. This cursor is **not** a permission, signature or secret; each API page checks the current authenticated user and live grants independently.
- `src/app/api/catalog/imports/policy-review-queue/route.ts`: accept only zero or one `cursor` query parameter; 400 on malformed input. Select a bounded 101-row window, scan at most 100 records and return up to 30 current, independently reviewable batches with `hasMore` and `nextCursor`. If 30 records are found early, resume from the last examined event instead of skipping unprocessed candidates. If a window has only out-of-scope, corrupt, already reviewed or duplicate revisions, return **zero entries with a next page** when later records remain. Stage 63 history integrity and Stage 64 full-batch current master scope checks remain in the same organization-locked RepeatableRead transaction.
- The 100-event **per-request** bound remains, but the previous hard `policy_queue_history_limit_exceeded` at 101 total events is removed. Each page is private, no-store, and metadata-only; no medical values, prices, signatory identities, proposal contents or raw audits are returned.
- `src/components/catalog-policy-draft-review-queue.tsx`: AR/EN Previous / Next, numbered pages, refresh restarting at first page, strict cursor response contract and empty-but-more notice. Review actions stay revalidated by the independent detail GET/POST.
- `tests/stage-65-policy-queue-pagination.test.ts`: invalid/canonical cursor, ordering with identical timestamps, early stop, empty windows, revision replay rejection and source/UI checks.
- `tests/stage-65-policy-queue-pagination-mariadb.integration.test.ts`: two MariaDB connections, 103 AuditEvents over 102 staged batches, stable 100+3 keyset pages, same-millisecond ordering, old-revision suppression, tenant isolation and no clinical/master writes.
- `.github/workflows/ci.yml`: Stage 65 MariaDB CI gate.

## Limits / safety
- Pagination is **not** a snapshot across multiple HTTP requests. New AuditEvents, revoked grants or new source drift can change eligibility between pages; the reviewer should refresh, and independent detail GET/POST revalidate current history, scope and authority atomically before disclosing policy choices or logging any decision.
- The cursor encodes only timestamp and audit-event ID as positional query information. It is not cryptographically signed and is always untrusted.
- Scanning remains bounded to 100 audit events per request and at most 30 returned eligible batches; very large queues require the user to page sequentially, including through pages with zero eligible results. A cursor is not reusable as approval evidence.
- As in Stages 59–64, the entire workflow is **nonbinding discussion**, with `reviewOnly=true`, `approved=false`, `signingEnabled=false`, `activated=false`, `liveWrites=false`. No effective-dated clinical/range/price application, electronic signature, financial sign-off, patient history mutation, schema migration or equipment integration activation.
- Human authority design and clinical/financial UAT remain deferred pending full-system readiness and explicitly approved governance. Deployment is to Hostinger only after feature SHA CI, PR merge, independently successful merged-main SHA CI and user confirmation.
