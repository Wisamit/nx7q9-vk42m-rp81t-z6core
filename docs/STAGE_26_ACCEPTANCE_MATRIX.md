# Stage 26 — Staged Price Import Reconciliation (Read-Only)

**Base main:** `7e86bda9217321e256c9cec6cfad838022316b2f` (Stage 25 merged; main CI #889 succeeded).

## Delivered engineering scope

- Adds `GET /api/catalog/imports/[id]/prices/reconcile?after=<rowNumber>` with both `pricing.manage` and `catalog.manage`, tenant-owned batch filtering, 100+1 page reads, validated cursors, counts-only audit, and no-store response.
- Resolves staged price-list/test identities against same-organization active masters; derives currency from the live price list, never from an untrusted row.
- Refuses malformed `DECIMAL(18,4)` strings, invalid exact calendar dates, missing/inactive mapping targets, repeated staged identity, out-of-window effective dates and overlap with existing live price windows.
- Supplies bilingual Arabic/English preview in the catalog import batch, explicitly marked **review only**. `READY_FOR_GOVERNANCE` does not authorize mutation.
- Existing safe import commit allowlist is **unchanged**; no prices, taxes, payments, invoices, report snapshots or clinical results are written by this feature.

## Still required / not represented as completed

- Separate governed financial approval, live-price versioned import and policy for replacing or overlapping effective-dated prices. Tax/contract policy must be explicitly approved before introducing financial mutations.
- Stronger organization-scale reconciliation with bounded batch-wide duplicate checks and independent real MariaDB integration verification remains necessary before a price-governance commit can be accepted.
- All Master Scope §§1–88 remain in scope. Analyzer Bridge PR #128 remains Draft and requires independent reconciliation.
- Full manual browser/device, financial/clinical acceptance and Hostinger deployment confirmation are **DEFERRED**, not passed.
