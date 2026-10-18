# Issue #265 — Settings-driven date/time display across eight LIS workspaces

## Source audit and implemented correction

Existing `SystemDateText` already observes root organization `data-date-format`,
`data-timezone`, `data-time-format` and `data-show-seconds` attributes,
reactively and without fetching account settings individually. Its correct
`instant` and `instant-date` modes are reused; no competing formatter,
hardcoded clinic timezone, date format or translated clinical value was added.

Prior UI source displayed unqualified UTC substrings or browser-locale dates
in eight components even though the organization could select other time zones
and date/time formats:

| Component | Governed fields | Presentation semantics |
| --- | --- | --- |
| `quality-management-console` | CAPA due, document review due, training, competency, instrument authorization, indicator period, audit scheduled | Distinguishes SQL UTC-midnight **calendar dates** from actual event dates |
| `client-account-manager` | invoice issued date, statement generated datetime, statement period bounds | True instants use organization timezone; statement boundaries are immutable calendar dates |
| `digital-services-console` | client portal corporate grant validity, booking and home collection times | Calendar grant dates remain same intended day; appointment instants convert to organization timezone |
| `eqa-workspace` | external proficiency round due date/time | Replaces browser `toLocaleString` with shared root-configured organization formatter |
| `inventory-lot-safety-manager` | lot expiry date and immutable safety-event history | Date-only expiry is unchanged; actual event instant includes configured time |
| `inventory-lot-branch-response` | append-only branch response time | Actual event instant |
| `patient-result-trends` | released numeric analyte observation timestamps in authorized trend table | Actual observation instant; no data or chart values changed |
| `report-cumulative-comparison` | authorized prior report issuance timestamps | Actual report instant; no result/version history changed |

## Deliberate UTC-midnight calendar handling

The new `SystemDateText kind="calendar-record"` is **not** a timezone-conversion
shortcut for arbitrary events. It calls the pure `parseUtcCalendarRecord`
function, which accepts only an explicitly UTC-midnight, parseable SQL-style
calendar record (`YYYY-MM-DDT00:00:00[.000]Z`). Calendar dates do **not** shift
when switching from Dubai to a negative-offset branch/organization timezone.
Malformed records, offset/naive timestamps, non-midnight timestamps and
invalid dates fail closed, showing an unavailable display rather than silently
inventing a date. The `time` element exposes its canonical calendar date;
true instants retain the timestamp and timezone context in the title.

Calendar-only values such as stock expiry and statement boundaries use the
preexisting `kind="calendar"`; issued reports, invoices, acknowledgements,
appointments and EQA submission times use the preexisting `instant` or
`instant-date` modes, preserving UTC truth and using the organization timezone
for the visible display. No clinical range, value, test, approval, order,
invoice, tax, specimen custody, QMS policy, actual due-time cutoff, or access
rights were changed.

**No clinical or financial data migration. No new server API behavior.**
Historical data and branch/tenant filtering remain as before.

## Automated and deferred acceptance

New `tests/ui-settings-driven-cross-module-dates.test.ts` covers:
- independently rendered instants across Asia/Dubai and America/New_York,
  exact date-boundary behavior, DD/MM and MM/DD changes;
- UTC-midnight calendar day stability and rejection of shifted/malformed dates;
- fail-closed naive timestamps;
- existing reactive root-settings subscription and semantic `time` metadata;
- all eight component render paths and their preserved input forms;
- canonical 81-route UI inventory/acceptance disclaimer.

Existing CI MariaDB, clinical/finance authorization, source-safety, theme,
bilingual checks and Next production build remain mandatory at exact SHA.

**NOT_EXECUTED:** full private synthetic browser verification of all 81 routes,
real screen-reader/keyboard, RTL/LTR, mobile/tablet, changed organization
palette and timezone at runtime, per-role/branch sessions, annotated
screenshot before/after, final qualified operator acceptance. These tasks
remain Issue #265 OPEN. Existing legacy page-level date displays not in
this increment require subsequent audit; this package is not full-project UX
acceptance or a compliance certification.

Issue #250: real laboratory, medical, finance, devices, backup restore,
Hostinger qualification and signatures remain **NO_GO** until actual private
acceptance evidence; automated CI is not a substitute.
