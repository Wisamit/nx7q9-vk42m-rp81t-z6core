# Stage 99 — Branch Recall Response and Quality Escalation Trail

## Verified baseline
- Owner-confirmed last Hostinger deployment: Stage 96 `e3a0d3fc0a774fcb59d4163e20674070a14f9c4a`.
- GitHub already contains Stage 97 recall safeguards and Stage 98 read-only lot impact evidence on `main` `656f3e3914bb198be7c437385931702bd70b0dc8` (CI #1147 SUCCESS). They are not duplicated.
- This stage adds a **separate, append-only local branch response trail** to an organization-wide quarantine or recall. It does not infer clinical exposure or modify stock.

## Business workflow
- An affected, authorized branch can record `NOTICE_RECEIVED`, `STOCK_ISOLATED` (operator attestation only), or `ESCALATED_TO_QUALITY` for **the latest** quarantine/recall safety event.
- Requires `inventory.manage`, active branch in an actual live user-branch scope, ACTIVE lot and active/current QUARANTINED or RECALLED state. Branch must have lot stock, historical movement, transfer participation, or linked QC evidence.
- Each event/action is unique per branch. Replaying or using a stale safety event is refused. A response must contain 20–1000 characters of explicit evidence. A newer safety decision invalidates stale response targets.
- The lot row is locked using existing Stage 97 safety lock order before checking decision and writing the response. Appends both an immutable response and an audit event in one Serializable transaction.
- Staff see only responses of their current active branch (not another branch's restricted operations). Historical response remains linked to original safety event and cannot mutate it.
- UI is integrated into Stage 98 lot-impact investigation, bilingual, with clear warnings that branch response does **not** lift recalls, certify physical stock reconciliation, or establish patient exposure.
- No doctor/patient/client portal disclosure. No result, patient, invoice, published report or existing lot ledger mutation.

## Gates
- Strict response/reason parser safety tests; branch and tenant checks; latest event compare and lot lock; no clinical inference; no stock writes.
- MariaDB integration: FK-backed immutable response, unique branch/event/action, tenant-scope selection, retained safety decision, and concurrency lock.
- Full CI on exact feature SHA; merge only after SUCCESS; independently verify CI on exact merged-main SHA.

## Deployment
- Additive migration `20261012230000_inventory_lot_branch_responses`. Back up Hostinger DB before running Prisma migrate deploy.
- No new secret or external dependency.
- All field validation/UAT and physical stock handling remains for authorized quality/inventory staff under existing project release policy.
- Draft PRs #128 and #209 unchanged.
