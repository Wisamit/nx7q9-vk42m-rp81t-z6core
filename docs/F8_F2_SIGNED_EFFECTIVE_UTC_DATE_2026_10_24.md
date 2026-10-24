# F8 §87 — Signed F2 effective UTC calendar integrity

**Base main:** `8829e56abd5c2a7d62fe75bfc2f364d24c0a577b`, CI #40013903806 completed success.

## Confirmed production-safety defect

The already-existing independently approved F2 ten-class configuration pipeline checks `effectiveAt` using the required UTC-looking format plus a finite JavaScript `Date.parse` result. JavaScript normalizes invalid calendar days such as `2026-02-30T00:00:00.000Z` to March 2, instead of rejecting every such source string. An independently signed effective date could therefore diverge from the physical release timestamp when translated to a database Date. The signed MFA and decision timestamp parser used the same weak predicate; the native version source effectiveFrom date parser was also rollover-tolerant.

This is not about choosing a medically safe date or determining legal tax rates. It is about preserving the **exact already-signed calendar instant** so there can never be a silent change of effective date.

## Code delivered

- `src/lib/catalog-f2-utc-instant.ts`: one small pure validator accepts only explicit `YYYY-MM-DDTHH:mm:ss.sssZ` and verifies exact UTC roundtrip using `new Date(timestamp).toISOString() === input`. Rejects invalid month/day, leap days, 24h rollover, overflow minutes/seconds, offset spelling and hidden whitespace. Does not convert time zones.
- `catalog-f2-approval-evidence.ts`: both clinical and financial signers' effective date, MFA evidence timestamp and signedAt must match the same exact instant; existing two independent signer HMAC/chained approval and authorization unchanged.
- `catalog-f2-apply-plan.ts`: rejects an impossible approved date **before** signing any ten-class effective plan. Existing immutable source snapshots, permissions, CAS, effective-version history and audit unchanged.
- `catalog-f2-effective-versions.ts`: reads historical reference/tariff effectiveFrom as a strict UTC instant before CAS and new version creation; never uses a normalized rollover date in a closing boundary.
- Negative and positive synthetic tests protect signed context, revision verification, complete plan integrity and date boundaries; no patient data or actual tariffs are used.

## Safety and scope

§87 source-to-target field activation remains **PARTIAL**, even though the F2 guarded apply/reverse engine already exists. §§75,86,88 qualified clinical/vendor, accountant and original MDB evidence remain **BLOCKED_EXTERNAL**. F7 protected owner browser 0/486 and F8 88 qualified cases NOT_EXECUTED; seven independent expert signoffs absent, **NO_GO**. No public screenshots, PHI, real device tests, Hostinger deploy SHA or restore evidence asserted.

**Merge policy:** latest exact feature HEAD full CI completed SUCCESS; merge with expected HEAD; fresh independent `main` push CI SUCCESS on exact resulting merge SHA; no manual owner participation during remaining software development.
