# Stage 11 — Inventory and procurement integrity acceptance

**Base:** main `6d0338deb9d44948e5550203d5ee7a6a7757bfc7` (Stage 10 merged and CI #823 green).
**Scope:** existing branch-specific stock, lots, expiry/FEFO, suppliers, purchase requests/orders, goods receipts, consumptions, adjustments and inter-branch stock transfers. No parallel tables.

## Stage increment

- Transfer receipt validates every submitted transfer item ID against the actual transfer and rejects duplicate or foreign identifiers **before** posting inventory movements. The request cannot silently double-count or overwrite a duplicate Map key.
- Transfer receipt re-reads received quantities inside the serializable transaction to ensure cumulative receipts cannot exceed dispatched quantities when two receiving operators work concurrently.
- Goods receipt posting aggregates every receipt row belonging to the same PO line, validates the combined quantity against the PO ordered/previously received amount, and increments the PO line **once**, avoiding lost updates and over-receipt from repeat lines.
- The historical stock movement ledger is maintained inside the same transaction as stock balance updates. No destructive mutation of posted receipt/transfer history.
- Automated source regression checks live in `tests/stage-11-inventory-integrity.test.ts`.

## Release gates

- [ ] Exact branch head CI passes migrations, all safety tests, MariaDB integrations, TypeScript, lint and production build
- [ ] No unverified payment/financial bookkeeping assumptions are added
- [ ] Merge only after passing CI and verify `main` CI afterward
- [ ] Hostinger deployment independently confirmed by owner
- [ ] Manual stock counts, barcode scans, lab consumable handling, expiry and hardware/UAT **deferred** to whole-project acceptance

**Safety limitation:** Passing CI is not a real stocktake, supplier delivery acceptance or clinical reagent suitability assessment.
