# UI Batch 06 — Operating dates, branch-local timelines, and immutable history

**Baseline `main`:** `356d656c8e212f7ec0f2c790955175520ea7f4a5`  
**Scope:** Ten previously untouched canonical routes from `docs/UI_ROUTE_MANIFEST.json`; **47 + 10 = 57 distinct source-level route sweeps out of 81**, **24 still unaddressed**. This is source coverage, **NOT browser UAT**.

## Ten canonical screens

| Route | Source-level change / verification |
| --- | --- |
| `/billing/accounts/credit-limits` | Policy last-updated audit time renders through configured date/instant widget, without recalculating credit exposure or limit |
| `/billing/cashier` | Shift open time displays in the shift's actual operating branch timezone; money/closing snapshots unchanged |
| `/billing/payment-methods` | Audit-friendly updated timestamp added to operational configuration list; historical payment snapshots unchanged |
| `/microbiology` | Most recent case activity displays by performing branch timezone; case/result status unchanged |
| `/phlebotomy` | DOB second-identifier editor honors configured calendar date, sends ISO to existing server verification; failed attempts use actual collection branch timezone |
| `/specimens/scan` | Collection, reception, rejection and usage event timelines display in the recorded event's branch timezone, no barcode/custody mutation |
| `/specimens/retention` | Branch-local created/approved/due timestamps; retention policy/approval and disposal eligibility unchanged |
| `/send-outs` | Configured date+time editor for expected result, server interprets branch-local wall time with explicit authorized active branch zone; rejects DST gaps/folds rather than guessing; custody events and deadlines localized. UTC instants remain canonical. |
| `/referrers` | Updated timestamps shown in client and referrer lists without changing stored master data |
| `/report-templates` | Latest layout-version creation timestamp displayed, with branch timezone where applicable, without retroactively rendering old released reports |

Additional shared component adjustment: specimen usage history shown on `/specimens` is consistent with the same branch-local audit display used by the scanner. This is a revisit, not an eleventh distinct newly covered route.

## Preservation and checks

- **Date-only:** `SystemDateField` presents the saved organization date format (for example `DD/MM/YYYY`) but the named form value remains ISO `YYYY-MM-DD`; DOB must never be shifted by an instant timezone.
- **Event timestamps:** `SystemDateText` preserves original instant in semantic `<time dateTime>`, displays configured date/12–24h/seconds with an explicit operational branch timezone when available.
- **Local deadline creation:** `parseBranchExpectedInstant` resolves the `YYYY-MM-DDTHH:mm` wall clock against the authorized, active branch's IANA timezone. Ambiguous or nonexistent DST clock readings fail closed. Explicit offset-qualified ISO remains supported for integrations.
- **History:** no Prisma migration; no update to released results, report versions, original prices, tax/currency, reference intervals, or immutable report snapshots; no new clinical interpretation.
- **Verification:** `tests/system-date-display-batch-06.test.ts` (date examples, leap days, month boundaries, DST gap/fold, ten routes, source and branch safety); existing CI includes Prisma/MariaDB, TypeScript, ESLint, source safety and production build.

## Gates still open

- Issue #265: **81-route interactive browser review**, 486 planned captures, AR/EN RTL/LTR/responsive/input/error/keyboard verification, staged synthetic accounts and 17 dynamic fixtures: **NOT EXECUTED**.
- Issue #250: **Stage132 real-world medical and financial UAT** and Master Scope §§75/86/87/88: **NO_GO / NOT SIGNED OFF**.
- Medical director, legal/tax, real equipment/barcode/printer, external laboratory protocols, provider integrations, backup/isolated restore, security and non-synthetic data checks remain **deferred, not waived**.
- Passing GitHub CI is a software merge gate only; Hostinger deployment requires owner's separate version confirmation.
