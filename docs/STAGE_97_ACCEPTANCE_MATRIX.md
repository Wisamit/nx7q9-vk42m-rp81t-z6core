# Stage 97 — Inventory Lot Quarantine, Organization-wide Recall and Independent Release

## Baseline and verified gap
- Hostinger deployment confirmed by owner at `e3a0d3fc0a774fcb59d4163e20674070a14f9c4a` (Stage 96), CI #1143 SUCCESS.
- Master Scope inventory/QC/specimen safety: lot-number traceability, branch-specific stock, controlled quarantine and manufacturer recall.
- Existing inventory, FEFO/expiry checks, physical stock, stock movements, transfers, procurement, analyzer QC remain intact. No duplicate inventory or QC subsystems.

## Safety transitions
- `AVAILABLE -> QUARANTINED`: authorized `inventory.manage` staff, active branch scope, mandatory 20–1000-character documented reason. Applies to the **organization-wide lot**, including all branches and existing pending transfers, immediately.
- `AVAILABLE/QUARANTINED -> RECALLED`: irrevocable safety action. The lot **never** returns to `AVAILABLE`; old ledger/physical stock remains visible.
- `QUARANTINED -> AVAILABLE`: an **independent staff reviewer**, different from the author of the most recent quarantine decision, with `inventory.manage` permission **and active branch scopes for every branch holding or reserving stock**. Requires a documented reason, and refuses reopening if active approved/in-transit transfers reference the lot; such transfers must be resolved first.
- All other transitions reject. The original `InventoryLot.status` soft-deactivation remains separate, and inactive lot records cannot be reopened via this workflow.
- A transition creates a permanently retained `InventoryLotSafetyEvent` with actor, active branch, org, prior/next state, reason, timestamp and per-branch physical/on-reserve quantities, and a separate significant `audit_events` record. No destructive edit to history.
- Emergencies may be declared from an authorized branch with an active staff session to protect **all branches immediately**. This does not grant staff read access to other branches' stock balances.

## Enforced workflows
- Lot-row `FOR UPDATE` locking in deterministic ID order is shared between the quarantine writer and **every stock writer**: FEFO consumption, reserved transfer approval, dispatch of previously approved transfers, inbound adjustments, existing-lot goods receipts, physical inbound custody of already shipped transfers, and QC runs using an inventory-linked QC lot.
- FEFO cannot allocate quarantined/recalled lots even if branch aggregate on-hand balances remain positive.
- `ADJUSTMENT_IN` on held lots is prohibited. Controlled `DISPOSAL` and other documented decrements remain permitted without authorizing use.
- Goods receipts for an existing held lot fail; a duplicate lot number cannot create a second unrestricted lot due to the unique organization/item/lot key.
- A dispatched shipment may physically arrive after a recall. Receiving it is **allowed for chain-of-custody**; the organization-level hold continues through the receiving branch and blocks later clinical/operational use.
- Stock balances/transactions are **not automatically corrected** by quarantine or recall; authorized later physical reconciliation or destruction is a separate auditable action.
- QC entry is refused when linked control inventory lot has an active hold; existing analytical/QC history cannot be rewritten by later recall.

## Data and UI
- Additive Prisma/MariaDB migration `20261012211500_inventory_lot_safety`: status default `AVAILABLE` on existing lots; append-only safety-event table with FKs and indexes.
- Bilingual / RTL+LTR inventory operations screen lists **only lot stock from assigned branches**, displays organization-level safety status and current latest-50 visible-lot decision events, and lets `inventory.manage` staff record safe transitions.
- No extra secrets or external dependencies. No automatic patient/report or invoice modification.
- Customer/doctor/patient portal access does not include safety-management content.

## Automated acceptance
- Node safety tests: transition matrix, long documented reasons, complete seven-route lock coverage, no recall undo, scope enforcement, independent reviewer and pending-transfer gate.
- Two-connection MariaDB integration: consistent organization boundary, row-lock serialization, failed stale claim, quarantine/release/recall event immutability, preserved physical branch quantities and audit.
- Full feature CI (Prisma migrate/generate/status, original tests + Stage97 tests, TypeScript, ESLint, UI i18n, Next build), then exact-SHA PR merge and fresh independent merged-main CI.

## Deployment / clinical acceptance
- Hostinger DB backup is mandatory before migration. The old system must not use a stale app version against the new lot status column while restarting; deploy during an operational maintenance window.
- This is engineering automated acceptance, not finished clinical/inventory field UAT. Manufacturer recall procedures, inventory reconciliation, training, physical shipment-handling and staff access review remain to be verified in final UAT.
- Draft Analyzer Bridge PR #128 and obsolete Draft PR #209 remain untouched.
