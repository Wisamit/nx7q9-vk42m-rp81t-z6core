# Stage 98 — Inventory Lot Recall Impact Traceability

## Baseline
- Owner confirmed Stage 96 deployed: `e3a0d3fc0a774fcb59d4163e20674070a14f9c4a`.
- Current GitHub `main` already includes Stage 97, SHA `c2774d718789fa8ae42b1f4d315a97a05cd3af00`, CI #1145 SUCCESS; it is not implemented again.
- This is a strictly read-only investigation aid for affected batches, complementing Stage 97's irreversible lot recall/quarantine decisions.

## Investigation
- New `/inventory/lot-impact/[lotId]` from the existing inventory lot safety manager.
- Requires staff `inventory.view`, organization ownership and an explicit live active branch scope with relevant stock, movement, transfer or QC evidence.
- Shows only authorized branch balances, prior stock movements, linked transfer custody and linked QC results, with stable sort, pagination and source record identifiers.
- QC trace resolves `QcResult -> QcTarget -> QcLot -> InventoryLot`; stock movements resolve by their immutable `lot_id`.
- Transfer participants display their branch codes as context, **not** other branches' protected stock balances or users.
- Does not infer individual patient/test exposure: the existing stock movement source reference must first be clinically verified before a result amendment or communication can be made.
- No reporting mutation, no new database table, and no changes to Stage 97 quarantine/recall policy.

## Gates and deployment
- Safety tests enforce tenant/branch filtering, immutable source evidence, authorized entrypoint and no patient leakage.
- Full repository CI enforces migration status, old integration tests, TypeScript, ESLint, bilingual UI and production build.
- Deploy only after feature CI SUCCESS, same-SHA merge, and independently successful main CI. No new environment variables or database migration.
- Clinical/manual quality investigation and real patient impact acceptance are deferred to authorized staff; software alone does not diagnose exposure.
