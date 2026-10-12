# Stage 89 — Independently Approved Report-Level Interpretive Comments

## Source / scope
User confirmed Stage 88 deployed on Hostinger. Exact starting main SHA `4b79ddab66921bf56ba16b42772a7c335e5d611e` and main CI #1089 SUCCESS. Master Scope §§37 (component/test/order/report interpretive comments), 38 (independent review), 40 (released amendments), 41 (audit), 42–43 (reports), 73 (bilingual) and 80 (immutable issued history). Existing order clinical notes and individual result comments already snapshot on issue, but no independently governed bilingual **report-level interpretation**.

## Implemented
- Additive `report_interpretive_comments` with order+organization FK, unique per-order sequential revisions, predecessor FK, English/Arabic source text, independent creator and reviewer user FKs, decision reason and time, status DRAFT/APPROVED/REJECTED/RETIRED. No updates of approved/rejected clinical text in workflow.
- Author `POST /api/reports/interpretations` requires `reports.view` + `results.medical_validate`; checks organization, ordering branch and department scope. Locks order in Serializable transaction; rejects multiple concurrent DRAFTs, no-op duplicate approved wording, malformed or incomplete text. Writes draft audit and review fingerprint.
- Reviewer `PATCH /api/reports/interpretations` requires `reports.view` + `results.release`, branch/department authorization, **different from creator**, reason 10–1000 chars and explicit approval for exact English/Arabic contents and predecessor. Locked Serializable transaction approves or rejects; atomically retires the previously approved interpretation only on approval, with separate audit. Stale fingerprint and concurrent decisions fail closed.
- `/reports/[orderId]/interpretation` bilingual draft/review/history. Linked from order detail before report release and from report toolbar. Users with department restrictions cannot read/comment on another department's order.
- `buildDiagnosticReportSnapshot` copies only **current APPROVED** interpretation and provenance into a **new version's** `contentSnapshot`; the released report renderer reads **the frozen snapshot only**, never current master data. Existing report JSON without this key remains valid. Later interpretation approval **does not issue a new report version** or mutate prior results/report versions; any required clinical amendment must use authorized report release workflow.
- No hardcoded test codes/names, no new environmental variables, no new external services.

## Acceptance matrix
- Strict bilingual text 1–5000 characters each and control-character rejection; full-text SHA256 review fingerprint bound to order, tenant, revision, predecessor, original author, date, status.
- Permissions and active branch, department scoping, independent creator vs reviewer, exact clinical review reason, explicit confirmation.
- Create/review/retire atomic on locked order; unique revision index prevents forks; no unreviewed note in issuance; old report snapshots never rewritten.
- `tests/stage-89-report-interpretation-safety.test.ts` and `tests/stage-89-report-interpretation-mariadb.integration.test.ts` plus all existing CI gates (migration, Prisma status/generate, Node safety, real MariaDB suites, TypeScript, lint, RTL/LTR checks, production build).
- Manual clinical UAT, report printer and real analyzer validation deferred to end-of-project, **not** marked complete.

## Deployment
- **Database migration required**: `20261012145000_report_interpretation_review`; back up Hostinger DB then deploy using existing `prisma migrate deploy` procedure. Additive new table, no destructive update.
- Existing issued reports unchanged. No new environment variables.
- PR #128 Analyzer Bridge must remain OPEN/DRAFT, unmodified and unmerged.

## Out-of-scope this increment but remains Master Scope
Explicit order-level interpretive annotations separate from intake clinical notes, advanced reporting policy and signatures, configurable reusable order/report comment template selection, and clinical rules for adding revised interpretation to released reports.
