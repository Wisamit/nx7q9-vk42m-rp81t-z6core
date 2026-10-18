# Issue #265: branch-aware event date display — analyzer, QC, equipment, stock, procurement and finance

Baseline: deployed and owner-confirmed `main` `f0689caf804f1ad61da17d303a4ce7f472346e1e`.
This increment addresses a second, separate set of unsafe or inconsistent **display-only** UTC substring renderings; it is not a clinical or financial workflow rewrite.

| Route | Previous unqualified presentation | New display and semantic context |
| --- | --- | --- |
| `/analyzers` | Raw UTC strings for outbound Bridge work orders, retries, inbound messages, imports, mapping approvals and retirements; date-only truncation of mapping effectiveness | `SystemDateText` with actual analyzer branch timezone. **Mapping effective-from** from the date-only editor uses strict `calendar-record`; **mapping effective-to** uses full actual instant because independent approval/supersession/retirement can set a sub-day timestamp. Approval and retirement display full instants; original codes, device commands, raw payload, permissions, dual-review, version history, CAS and audit unchanged |
| `/qc` | Raw UTC substring for QC run time | Branch-scoped run query now selects only branch timezone, rendering the actual QC event instant in that zone. Westgard evaluation, target/lot selection and release gate unaffected |
| `/equipment` | UTC date fragment for maintenance due calendar and actual calibration event | Maintenance due is displayed as a date-only SQL UTC-midnight calendar record; calibration performed-at is a branch-local **instant-date**. Original editor `YYYY-MM-DD` value remains canonical for backend |
| `/inventory` | UTC day fragment for FEFO expiry and UTC substring for supplier receipt | Immutable expiry calendar stays on its intended day; actual supplier goods receipt displays the receiving branch local time. FEFO ordering, stock ledgers and branch scopes unchanged |
| `/inventory/procurement` | UTC day fragment of request creation | Purchase request event day uses the requesting branch timezone; approvals, costs and snapshots unchanged |
| `/billing/reports` | Raw UTC timestamps for invoices, payment allocations, credit notes and refunds | Reuse the route's existing `reportTimeZone` (selected scoped branch, otherwise organization fallback), **the same timezone used to calculate financial report calendar boundaries**. Totals, currency segregation, transaction allocation, query filters, accounting tax, prices and financial snapshots unchanged |

## Core correctness distinctions

- SQL UTC-midnight **calendar records** represent a date label, not a wall-clock event: use `calendar-record` and reject malformed or non-midnight values; do not shift them to the preceding day in UTC-negative timezones.
- Event `DateTime` values with original ISO offset `Z` represent real UTC instants: use `instant` for full event times and `instant-date` when that particular table asks only for the event's day. Branch events with known branch context pass `timeZone={branch.timezone}`; all financial report events pass the same `reportTimeZone` as the period filter.
- Analyzer `effectiveTo` is **not guaranteed to be UTC midnight**. The mapping governance endpoint can set a predecessor cutoff to an instant one millisecond before the new mapping, or truncate at a retirement instant. It is deliberately shown as full instant and is never reinterpreted as a date-only value. `effectiveFrom` is selected via the current date-only editor.
- UTC instant metadata remains intact in the `<time>` element. Presentation must not modify backend timestamps, signed reports, device events, sample identification or paid invoices.

## Testing and remaining release conditions

`tests/ui-operational-finance-branch-dates.test.ts` checks six route surfaces, unchanged tenant/branch authorization, monetary computation evidence, QA state and FEFO comparator; verifies two timezones spanning a date boundary; protects mapping effective-to's precise cutoff; distinguishes UTC-midnight dates, and guards against reintroduced ISO truncation.

**No schema migration, backend service mutation, clinical threshold change, financial recalculation, or new analyzer/device command.**

**NOT_EXECUTED:** authenticated browser screenshots, complete 81-route visual acceptance, mobile/RTL keyboard & screen reader walks, live changed system color/date/time preferences, dedicated synthetic branch-clinical-operator cases, qualified calibration/QC and device acceptance. There remain other organization-format inconsistencies in date labels embedded inside selection option strings (e.g., QC lot option text) and additional routes to audit; this patch does not quietly mark universal settings compliance.

**Issue #265 OPEN** for the full visual/interaction gate. Issue #250 final real-life clinical/accounting/hardware/Hostinger restore UAT and GO/NO-GO remains **NO_GO**. Independent main CI and explicit owner Hostinger deployment acknowledgement remain required.
