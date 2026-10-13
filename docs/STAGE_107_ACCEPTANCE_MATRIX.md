# Stage 107 — Inventory Lot Recall → Quality Follow-up Worklists

## Grounded baseline
- Base: merged `main` SHA `2361d9ce05e00122247bd5b5bb47eb89c4c27a7d`, Stage 106, owner confirmed successful Hostinger deployment and independent main CI #1203 SUCCESS.
- Existing Stages 97–100 already provide organization-wide lot quarantine/recall, branch response escalation, impacted stock evidence and immutable linkage to branch Nonconformance. **Those are not rebuilt.**
- Historical unmerged Draft PR #224 includes the distinct read-only queue feature but diverged from current main and mislabelled it Stage 101, which is already the specimen retention/disposal release. This stage independently restages and improves that queue on current main; does not overwrite `docs/STAGE_101_ACCEPTANCE_MATRIX.md`.

## Delivered
1. Bilingual RTL/LTR `/inventory/recall-quality` operational overview scoped to the current authenticated user's organization, actual ACTIVE branch memberships and both `inventory.view` and `quality.nonconformance.manage`. Direct URL is also guarded; navigation is permission-scoped.
2. **Pending escalations**: newest up to 200 recorded branch escalation responses are scanned, and up to 40 actionable rows are shown, only if source lot is ACTIVE and QUARANTINED/RECALLED, the escalation links to the **latest** held safety event on that lot, and there is **no** formal quality-case link for that event and *same branch*. Stale events and resolved links are excluded without mutating their history. Clearly labelled as a bounded recent list, not a global backlog total. Each source link opens the existing lot-impact and formal quality case workflow; a different authorized branch must be made active before opening its case.
3. **Linked quality-case register**: server-side pagination (40 records/page, stable createdAt/id sorting), filter OPEN vs ALL, organization/branch scoping, count of active vs closed/cancelled NCs, branch, lot/item, investigator/owner, severity, status and source evidence link. Formally closed cases remain historically visible; no destructive mutation.
4. Side navigation and inventory operations link, visible only under the applicable permissions.
5. This stage is **read-only**. Formal severity, source examination, investigation and CAPA ownership remain in audited Quality Management. The new worklist never infers patient exposure, report amendments, stock release, reagent consumption or patient notification.

## Verification and non-goals
- Node source-safety test `tests/stage-107-recall-quality-worklist-safety.test.ts` covers both permissions, branch/tenant scope, latest event filters, pending work items, stable pagination and read-only contract.
- Real MariaDB integration test `tests/stage-107-recall-quality-worklist-mariadb.integration.test.ts` covers pending escalation existence, scope isolation, removal after atomic linked case creation, historical NC closed state and retained linkage.
- Green full CI at exact **final feature SHA**, PR merge with expected SHA and independent green merged `main` CI are required before Hostinger deployment.
- No migration and no configured medical limits, patient results, billing, inventory quantities, QC measurements or historical changes.
- Live UAT and lab SOP verification remain deferred to final acceptance. Pending overview is intentionally bounded; full backlog analytics can require a materialized summary at a future stage.
- Existing Draft PRs #128 (Analyzer Bridge) and #209 (obsolete interpretations) untouched. Superseded draft PR #224 must not be merged as-is; close with a supersession note only after this stage merges successfully, leaving the branch and commits for traceability.
