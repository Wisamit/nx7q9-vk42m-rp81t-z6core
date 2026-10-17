# UI Batch 07 — Clinical governance, secure portals and displayed dates

- Base `main`: `83279f594dd2e69e823087f253790720efdfe372` (owner-confirmed Hostinger deployment).
- Routes: **10 previously untouched manifest screens**; source review count **57 + 10 = 67/81 distinct**; **14 still await their first sweep**. This does not represent browser/UAT coverage.

| Canonical route | Scoped UI improvement |
| --- | --- |
| `/catalog/tests/[id]` | TAT/reference/order-question effective calendar dates and approval/retirement audit instants use configured date display; effective dates remain `YYYY-MM-DD` in stored values and clinical records |
| `/clinical-comments/review` | Read-only template review audit time follows displayed configured date format, explicitly marked UTC |
| `/doctor-portal-access` | Date/time editors display the configured date and submit an explicit ISO instant resolved in the authorized current branch timezone; DST gap/fold fails closed before request; existing tenant/permission/revocation API checks remain |
| `/doctor-requisitions` | Doctor requisition submission shown in the requisition's ordering branch timezone |
| `/security` | MFA confirmation audit instant follows organization date/time format, without modifying MFA state |
| `/queue-display/[branchId]` | Public queue shows the exact operating branch calendar day already used for queue filtering; no names/patient identifiers introduced |
| `/verify/report/[token]` | Public verification issue instant follows date display, explicitly UTC; token checks, frozen report, and verification status unchanged |
| `/portal` | Existing authorized orders, released-report pointers, bookings and invoice dates use their actual operational branch timezone; no changes to disclosure predicates, invoice amounts or released report content |
| `/catalog/imports/reconciliation-ledger` | Batch created/validated/imported audit instants use configured date, retaining immutable import lineage and original source evidence |
| `/settings/specimens` | Rejection reason master-data updated timestamp shown read-only; historical reasons already snapshotted in each clinical event are untouched |

## Safety invariants

- UI changes never rewrite released results, amended versions, report snapshots, laboratory thresholds, effective dates, amounts, historical master-data labels or currency.
- The physician's active authorized branch timezone is explicit when resolving locally entered grant dates. The server still receives ISO instants and runs all preexisting organization, independent permissions, patient/doctor verification, interval and audit validations. Missing/ambiguous local input is rejected client-side, not inferred from browser locale.
- Date-only effective policy intervals are not shifted through a timezone.
- Public queue privacy, public report token validation and portal patient/doctor/corporate disclosure scoping must not widen.
- Existing MariaDB authorization, portal, report version, comments, patient security and public queue test suites remain in CI. New `tests/system-date-display-batch-07.test.ts` checks source contracts, formatting and DST examples.
- **No database migration required.** No alterations to stored clinical/financial history.

## Outstanding release gates

1. **Issue #265: OPEN**, whole-browser interactive staging UI review (81 screens, 486 planned captures), Arabic/English, RTL/LTR, light/dark, mobile/desktop, keyboard/validation, permissions, synthetic data and screenshot evidence: **NOT EXECUTED**, never inferred from CI.
2. **Issue #250: OPEN**, final comprehensive clinical/financial/accounting/privacy/regulatory sign-off including Master Scope §§75/86/87/88, operational equipment, interfaces, backup/restore, physical acceptance: **NOT EXECUTED / NO_GO**.
3. Production deployment on Hostinger must be independently confirmed by the owner for the resulting exact `main` SHA.
