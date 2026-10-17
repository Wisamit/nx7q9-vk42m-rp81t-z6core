# Final remaining UI routes — Consolidated Batch 08

## Baseline and scope

- Previous owner-confirmed Hostinger deployment: `main c8faf1e850ca84f28e724783599b7c1444694d58` (PR #282).
- This batch covers every canonical manifest route lacking a demonstrable prior source-level pass: **16 distinct routes in one PR**.
- Accounting correction: documented "67/81 and 14 left" after batch 07 conflated component screens with distinct routes. Reconstructing the actual initial component-to-route mapping and literal route references in batch 03–07 tests produces **65 independently identifiable route paths**, not 67. Their complement in `docs/UI_ROUTE_MANIFEST.json` is **16 paths**.
- The automated test `tests/ui-final-remaining-16-route-sweep.test.ts` compares all 81 canonical manifest paths to the prior unique set and the 16 new paths. It guards against silently leaving out redirect-only `/` or counting repeated shared components as separate routes.

## All 16 audited/updated canonical paths

| # | Route | Batch 08 source-level UI change |
| --- | --- | --- |
| 1 | `/catalog/expert-reviews` | Expert flags and unapproved policy draft review queues reveal original UTC audit instants using organization date format; independent reviewers still do not approve or activate policies |
| 2 | `/catalog/imports/[id]` | Staged import batch original creation time shown explicitly in UTC; no staged/live candidate changes |
| 3 | `/catalog/legacy-master-data` | Signed configuration export provenance timestamp in UTC; checksum and manifest bytes untouched |
| 4 | `/clinical-comments/revisions` | Read-only approved comment source creation date shown within governed revision dialog; original version and independent reviewer approval invariant unchanged |
| 5 | `/login` | Clearly linked portal sign-in to avoid mixing staff and patient/physician authentication |
| 6 | `/organization/branches` | Cross-navigation to user and role scopes only for explicitly authorized permissions |
| 7 | `/` | Redirect-only canonical route. Preserve authenticated dashboard redirect and gate new installation setup by a genuine staff-existence query; no new public UI or admin bypass |
| 8 | `/patients/identifier-schemes` | Display last-modified read-only audit instant for central patient identifier schemes; no modification of identifiers or source records |
| 9 | `/portal/change-password` | Clarify that temporary credentials do not unlock protected portal data; permit navigation back to external portal sign-in, never skip password gate |
| 10 | `/portal/login` | Explicit separate staff sign-in link; portal clinical disclosure rules unchanged |
| 11 | `/portal/reports/[versionId]` | Branch-local released-report issue timestamp displayed outside historical report snapshot; access grant and retracted/superseded version gates unchanged |
| 12 | `/roles` | Permission-gated links to staff user management |
| 13 | `/settings` | Preview read-only currently saved organization date/time format in its configured timezone, without changing any versioned report |
| 14 | `/setup` | Failed network requests recover from saving state; duplicate submit while saving blocked; bootstrap server guards preserved |
| 15 | `/specimens/[id]/label` | Non-printing date-localized DOB cross-check; **printed DOB text, barcode, label size, requirement snapshots, and clinical invalid-specimen blocks unchanged** |
| 16 | `/users` | Permission-gated links to branch and role scoping views |

## Non-negotiable safety gates

- Code/documentation in English; app user copy in English + Arabic.
- Organization and branch scope, permission checks and source-of-truth server authority retained. A client navigation link does not grant access.
- Do not change clinical or invoice tables, migrations, numeric reference limits, statuses, effective policy rules, pricing, released reports, raw analyzer/QC history, specimen labels/barcodes or signed import evidence.
- Authentication/MFA/portal clinical disclosures and initial setup server-side checks remain authoritative.
- Date-only clinical patient DOB is formatted only in a non-print confirmation; the actual printed label stays in its already-approved ISO form.
- No modification to `docs/UI_ROUTE_MANIFEST.json`. 81 canonical route files still exist.

## Quality evidence and unresolved gates

- New final route coverage and privacy/clinical/print tests in `tests/ui-final-remaining-16-route-sweep.test.ts`, in addition to existing broad automated quality gates (TypeScript, ESLint, safety, real MariaDB, UI audit scripts, Next.js production build).
- **81/81 is a source-code UI route pass, not completed browser acceptance.** The full 81-route, Arabic/English, RTL/LTR, day/night, mobile/desktop, accessibility and screenshot/synthetic staging matrix in issue #265 remains **OPEN / NOT EXECUTED** until genuinely run.
- Physical equipment, analyzer bridges, backup/restore drills, clinical/financial UAT, and Master Scope §§75/86/87/88 in issue #250 remain **OPEN / NO-GO**; do not assert a production clinical release.
- After merge, full CI must succeed on the exact merged `main` SHA and owner confirms Hostinger deployment success before proceeding.
