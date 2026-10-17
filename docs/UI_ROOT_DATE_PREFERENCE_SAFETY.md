# UI core date/time preference reactivity and safe input semantics

## Verified defects

The globally shared date controls and audit timestamp views read organization
format/timezone settings from <html> data attributes, but used a no-op
useSyncExternalStore subscribe function. Changes during client navigation or
settings refresh could leave the visible format stale. A date editor also kept
only typed text, re-parsing it under the latest date format: a valid 05/11
entered under DD/MM could silently be interpreted as May 11 if the format
switched to MM/DD while the form remained open. That risks patient age/DOB,
clinical effective dates, and financial dates.

## Engineering change

- One shared MutationObserver-backed external store watches exactly the four
  organization-facing root attributes (format, timezone, 12/24 and seconds)
  and unregisters on unmount. Default server snapshots remain deterministic.
- Read-only SystemDateText and the live SystemClock refresh to current
  organization preferences without modifying underlying timestamps.
- SystemDateField stores a parsed canonical ISO date alongside the format at
  which it was entered. On a format change, a valid draft is re-rendered from
  its original ISO, not re-parsed as a different date. An invalid/partial
  draft remains invalid. Min/max constraints are still enforced, and FormData
  still receives only ISO YYYY-MM-DD (never user-formatted strings).
- SystemDateTimeField inherits this correction via SystemDateField; its
  existing HH:mm local-wall-clock and branch-specific server interpretation
  remain unchanged. No timezone shifts are applied to calendar-only values.
- Synthetic pure policy tests cover format switches, invalid dates, leap days,
  out-of-range dates, clearing/reset semantics, root observer lifecycle and
  component wiring. Existing project date/clinical tests remain required.

## Release limits

This fixes shared UI code paths, **not** real rendered 81-screen acceptance.
Qualified owner-controlled synthetic private-staging browser tests, keyboard,
RTL/LTR, mobile, roles and settings signoff are still NOT_EXECUTED under
Issue #265. Clinical/device/finance/backup go-live is NO_GO under Issue #250.
No patient snapshots, signed reports, production schedules, clinical limits
or financial values are changed. Full 88-section Master Scope remains active.
