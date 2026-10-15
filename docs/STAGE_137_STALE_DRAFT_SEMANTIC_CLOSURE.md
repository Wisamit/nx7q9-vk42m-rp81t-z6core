# Stage 137 — Closing historical Draft PRs without losing analyzer replay safety

Baseline: main `346d42ab01454867a8d1ae8d6ab95a0d55035d59` Stage136, independent main CI run `38742865082` SUCCESS. Historical Issue #250 was a Stage125 closure roadmap, not proof of Stage132 human approval.

## Exact semantic comparison

### Historical Draft PR #128 (Stage10 Analyzer Bridge)

**Present on main, with later hardening:** `bridge/protocols.mjs` and `bridge/mllp-listener.mjs` matched PR128 blob hashes exactly as inspected in the GitHub PR file list; `bridge/astm-e1381.mjs`, `src/app/api/integrations/analyzers/[id]/results/route.ts` and `tests/analyzer-bridge-mariadb.integration.test.ts` also matched exactly. `bridge/file-worker.mjs`, README, raw-message ingest, clinical import and parser tests are present but diverged due to Stage108+ protection. Current main has complete bridge service, persisted raw frame metadata and audit, MLLP, file spool, scoped analyzer mappings, locked specimen custody, result version claims, and explicit non-automatic release.

**Gap still on main** before this stage: `src/app/api/analyzers/messages/[id]/replay/route.ts` performed `tx.analyzerMessage.update({id})` following a *stale pre-transaction status read*, unlike PR128's compare-and-swap update. A concurrent bridge worker or user could advance a failed message between the read and write; manual replay could then reset newer state to RECEIVED. That is a real remaining clinical/integration safety regression; do not mark PR128 fully superseded until this stage passes.

**Stage137 remediation:** a transaction-scoped `updateMany` claim requiring matching `id`, failed `status`, exact `updatedAt`, `attempts` and current tenant/branch analyzer relation. A lost compare-and-swap returns HTTP 409 `analyzer_message_replay_state_changed`, with **no replay audit** and no mutation. Only successful claims increment attempts once and write an audit in the same transaction. Two independent MariaDB connections exercise lock conflict, single-winner replay, stale state refusal, already processed state, tenant fencing. No migration or credential change.

### Historical Draft PR #209 (Stage89 bilingual report interpretations)

**Present on main under the authoritative later Stage92:** `src/app/api/reports/interpretations/route.ts`, `src/app/reports/[orderId]/interpretation/page.tsx`, `src/components/report-interpretation-manager.tsx`, and `src/lib/report-interpretation.ts` matched PR209 blob hashes. Current schema includes `ReportInterpretiveComment`. Rather than PR209's never-merged migration `20261012145000_report_interpretation_review`, main already has `20261012180000_report_interpretation_governance` creating `report_interpretive_comments` with restrictive FKs and versioning, plus `tests/stage-92-report-interpretation-safety.test.ts` and real MariaDB test. **Never cherry-pick or merge PR209's old migration**: it would attempt to create an already existing table and invalidate deployment. The feature is already in production code pending qualified clinical human signoff.

### Historical Issue #250

Keep the roadmap issue open with honest `Stage132: REAL WORLD UAT NOT_EXECUTED` and explicitly record that parts of §87 spreadsheet import/activation and source row reconciliation remain open. Update checklist for delivered stage implementations without falsely checking off clinical/vendor signoffs. Historical PRs must not be merged into main; close only **after** semantic comparison and newer CI confirmation, preserving old PR history, documented closure reason and original branches.

## CI gates

New `tests/stage-137-analyzer-replay-cas-safety.test.ts`; `tests/stage-137-analyzer-replay-cas-mariadb.integration.test.ts` (two independent connections), and explicit workflow registration for Stage135 MariaDB author-only review privacy integration that was previously not included in CI. Full Prisma migration+generate, TypeScript, ESLint, test:safety, real MariaDB integration suite, AR/EN and Next build. Merge exact feature HEAD after complete success; then independent main CI; owner retains Hostinger deployment control.

**No clinical GO:** field instruments and vendor ACK still require authorized UAT, regardless of automation CI. All Stage132 cases remain not executed.
