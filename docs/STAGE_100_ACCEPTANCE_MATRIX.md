# Stage 100 — Recall Escalation to Branch Quality Nonconformance

## Base and scope
- Main baseline: Stage 99 `54398473b034e1aae0e4302ad8b7c0db61bb3fc5`, independent main CI #1152 SUCCESS.
- Stages 97–99 already handle organization-wide lot quarantine/recall, authorized branch impact tracing and immutable branch response; no duplicate stock logic.
- This stage closes the safety follow-through gap: turning the **current** branch's documented `ESCALATED_TO_QUALITY` response into a formally tracked Nonconformance in the pre-existing Quality Management module. Existing CAPA association/approval workflows remain unchanged.

## Server contract and clinical boundary
- `POST /api/inventory/lot-quality-cases` requires `inventory.view` plus `quality.nonconformance.manage`, active user scope and live ACTIVE branch within the staff tenant. Clients cannot select arbitrary branches or tenants.
- Human quality officer must enter investigation title (15–255 chars), narrative evidence (30–5000 chars), and **explicit** MAJOR/CRITICAL severity; there is **no automated severity or patient-exposure inference**.
- Serializable transaction rechecks live user/branch, locks active lot row, confirms QUARANTINED or RECALLED status, confirms request is for the latest unchanged held lot safety event, and confirms an immutable `ESCALATED_TO_QUALITY` response **from this exact branch for the same event**.
- One nonconformance per branch per safety event. New additive FK-backed `InventoryLotQualityCase` table has unique `(safety_event_id, branch_id)` and unique nonconformance linkage. Creation of the NC, link and actor/branch audit evidence is atomic. Competing requests fail without duplicate cases.
- The NC is branch-scoped; source reference is `InventoryLotSafetyEvent` and immutable branch response's note is captured as the immediate action evidence. Status starts OPEN. Quality staff can subsequently assign owner, perform root-cause review and link CAPA using the **existing** audited quality module.
- UI appears in `/inventory/lot-impact/[lotId]` only to staff allowed in the actual branch context, after formal escalation. Existing case number appears as evidence, never exposing another branch's quality cases or balances.
- No automatic patient notification, clinical result amendment, report revocation, invoice changes, lot release, ledger balancing or external manufacturer notification. A quality case is an investigation request, not a conclusion.

## Acceptance
- Safety tests for exact permission, active-branch scope, locked-lot transaction, current event, unique branch response, no patient/result/ledger changes, bilingual entry UI and immutable FK evidence.
- Two-connection MariaDB: tenant/branch isolation, unique event/branch/NC linkage, concurrent parent-lot lock, retained lot decision and open NC state.
- CI: Prisma migrate/status/generate, all prior tests + Stage 100 suites, TypeScript, ESLint, i18n/RTL and production build on exact final SHA. Merge only after PASS, then independent merged-main CI.
- Hostinger needs DB backup before additive `20261012235000_inventory_recall_quality_case_link` migration. No new external secrets.
- Field/clinical UAT remains deferred. Draft PR #128 Analyzer Bridge and superseded #209 remain untouched.
