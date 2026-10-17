# Large UI batch — Ten bilingual operational/financial search workspaces

## Baseline and exact scope

- Owner-confirmed Hostinger deployment: `73271fed8d2431638e16f6056309af3b455c7950` (PR #285, CI #1673 success).
- One consolidated change across **ten unique canonical route pages**, plus shared scoped styling, six structured source regression checks and release evidence.
- User specifically asked for **large, integrated batches**, not one-screen patch cycles. This batch covers patient search, clinical specimen collection, operational worklists, report queue, delivery follow-up, EQA programs, analytics, financial reports, and historical receivables.

| # | Canonical route | UI change |
| --- | --- | --- |
| 1 | `/analytics` | Responsive branch/date filter grid; bilingual reset to default 30-day view |
| 2 | `/billing/accounts/aging` | Compact responsive aging-scope/date fields; reset navigation without altering as-of historical calculations |
| 3 | `/billing/reports` | Grid to handle 11 real financial filter fields; explicit reset, with no mutation or cross-currency aggregation |
| 4 | `/orders/delivery-queue` | Branch/accession/status search alignment, long-table overflow |
| 5 | `/reports` | Issued-report filter grid and accessible long-table presentation; released versions never mutate |
| 6 | `/quality/eqa` | Branch/program search grid, clear/reset and responsive display |
| 7 | `/patients` | Accessible typed patient identity search, responsive queue filter |
| 8 | `/phlebotomy` | Bilingual labeled barcode and branch filters, preserving branch selection on reset |
| 9 | `/specimens` | Accessible barcode/status filters, usable touch-target layout and horizontal scroll |
| 10 | `/worklists` | Grid adapting eight worklist filters from desktop to mobile; labels for branch, department, priority, analyzer, specimen/clinical/TAT states |

## Non-negotiable semantics preserved

- All ten forms use **GET**, not mutations. Original query-parameter names, branch filters, server-side authorization, and existing pagination remain unchanged.
- Date-only form values remain through `SystemDateField`, preserving canonical ISO transport and organization display preferences.
- Billing: no change to monetary calculations, invoice/credit/payment/refund immutable history, currency separation or aging date semantics.
- Clinical: no change to patient identity, barcode traceability, phlebotomy two-identifier verification, results/release, report snapshots, worklist department/branch scope, specimen custody, QC or EQA evaluation.
- All user text added is English + Arabic; styling uses theme CSS tokens and adapts to RTL/LTR with focus-visible states.
- Long tables are contained in accessible horizontal-scroll containers rather than forcing the global page to overflow.

## Validation and final release truth

- New test `tests/ui-large-ten-search-queue-filter-surfaces.test.ts` verifies ten unique routes, exact filter names, permission guards, bilingual quick-filter labels, financial/clinical invariants, theme tokens, responsive styles and reset actions.
- Existing CI performs Prisma, TypeScript, ESLint, safety, real MariaDB integrations, UI static source audit and Next.js production build; require success on both feature HEAD and merged `main` SHA.
- **Source/CI evidence does not imply visual-browser acceptance**. Issues #265 and #250 remain OPEN; synthetic authorized staging route screenshots (AR/EN, RTL/LTR, Light/Dark, phone/tablet/desktop), keyboard navigation, print and clinical/financial/physical UAT have NOT EXECUTED status until truly performed.
- Hostinger deployment of the new merge must be confirmed by owner. No database migration.
