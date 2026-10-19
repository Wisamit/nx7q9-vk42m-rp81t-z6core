# Family Lab — consolidated send-out safety and finite release closure

**Baseline:** Owner confirmed Hostinger successfully deployed `2ee1bb292a830f4b82c263935e7a1e45b6b882e5` after the worker-limit fix. This bundle branches from that exact main SHA. Hosting remains Hostinger. No new optional product features or numbered Stages.

## Source-confirmed P1 defects (before this change)

1. `src/app/api/send-outs/[id]/actions/route.ts` read a referral status *before* beginning its transaction, then used unconditional `update({where:{id}})`. Two authenticated users could both act on an old `CREATED` referral: a dispatched record could be overwritten by cancellation or receive duplicate events/audits. The page disabled duplicate submissions only for one browser instance; it was not a server concurrency guarantee.
2. `DISPATCH` emitted a specimen custody event based on a specimen read outside the transaction. A sample transferred out, rejected or quarantined before dispatch could still be recorded as sent from the old branch.
3. `src/app/api/send-outs/route.ts` serialized duplicate referrals by order-item ID but did not recheck order cancellation/verification or current specimen-to-item linkage, active status and physical branch after acquiring its lock. A stale page candidate or concurrent specimen transfer could make a new referral point at the wrong physical custody location.
4. The client required a documented `CANCEL` reason; the server accepted `null`, leaving a cancellation audit without an operator explanation.

## Corrections

- Send-out lifecycle uses `updateMany` as an InnoDB compare-and-swap on `(id, organizationId, branchId, old status)`. A stale action gets HTTP 409 before any `SendOutEvent`, `SpecimenEvent` or `AuditEvent`. Fresh referral read and event/audit write share one transaction.
- At physical `DISPATCH`, recheck active order/item, lock the specimen row and validate its current organization, order, active item-link, physical branch and eligible status. Any failed check throws inside the transaction so the claimed status is rolled back along with all events; client receives HTTP 409.
- At referral creation, after acquiring the existing order-item lock, re-read live order/item status. Acquire the selected specimen row lock and re-check organization, order, active link, physical branch and status; preserve existing preanalytical version CAS for non-IN_PROCESS samples and independence between unrelated order items.
- Require nonempty trimmed cancellation reason at API boundary. No hidden state recovery, retry of ambiguous actions or synthetic audit data in production.

## Regression evidence

- `tests/release-closure-sendout-lifecycle.test.ts`: source/contract checks for ordered CAS, new branch/order/custody conditions, rollback-on-conflict and cancellation reason.
- `tests/release-closure-sendout-lifecycle-mariadb.integration.test.ts`: genuine two-connection MariaDB lock timeout and stale-write rejection; checks a single committed status/event and blocking/recheck of a transferred specimen. **This is a database-concurrency regression, not a complete authenticated browser E2E test.**
- CI runs the new MariaDB suite plus all existing clinical, billing, interbranch, Prisma, TypeScript, ESLint, theme/i18n and Next.js build checks on feature SHA and independent main SHA. Hostinger deployment still needs owner confirmation.
- No Prisma migrations, table changes, data modification, force push, database rollback, analyzer policy changes, or historical clinical/financial rewrite.

## Entire product closure / acceptance state — intentionally not overstated

| Gate | Status / available evidence |
| --- | --- |
| Original 88 Master Scope sections | All 88 source anchors inventoried by `scripts/release-closure-evidence.mjs`; **not 88 interactive or professional UAT passes** |
| 81 `page.tsx` routes | Canonical manifest checked by `scripts/ui-full-surface-audit.mjs`; actual interactive screenshots/AR/EN/RTL, branch roles, date/time and responsive review still **NOT_EXECUTED** |
| Patient → order → billing → sample → transfer → validated/amended report | Existing automated suites; clinical/financial field signoff **NOT_EXECUTED** |
| §75 analyzer interference | Qualified device/medical policy still needed; no thresholds invented |
| §86 currency/tax | Accountant/owner policy approval still needed; no rule inferred |
| §87 full field-level governed spreadsheet activation | Partial; never mark review-only imports as live activation |
| §88 exact MDB reconciliation | Real row-by-row expert-reviewed source matching remains pending |
| Issue #265 | OPEN, all 81-screen real browser/UX acceptance remains pending |
| Issue #250 | OPEN, 88 qualified real-world UAT cases and GO/NO_GO remain **NOT_EXECUTED / NO_GO** |

A green pipeline certifies only the checks it actually runs. This PR is a **P1 correction package**, not declaration that Family Lab is already a Software RC or medically approved production system.
