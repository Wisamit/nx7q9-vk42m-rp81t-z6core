# UX closure — six governed clinical draft authoring dialogs

## Deployment baseline

- Owner confirmed Hostinger deployment of prior `main` SHA
  `5a41cee20af2c360cedfd294eaeee20c510c97cb`
  (PR #273). No deployment is asserted for this package.
- Master Scope `02_MASTER_SCOPE.md` remains the full target scope,
  and issues #265 (end-to-end UI) and #250 (qualified release gate) remain OPEN.

## Specific changes in this package

The `/clinical-rules` route previously displayed **six inline mutation
forms** across three directly imported manager components:

| Authoring form | POST API retained | Draft release semantics |
| --- | --- | --- |
| Delta comparisons | `/api/clinical-rules/delta` | `INACTIVE` until authorized approval |
| Result comment templates | `/api/clinical-rules/comments` | `INACTIVE` and independent reviewer signoff |
| Calculated result formulas | `/api/clinical-rules/calculated` | `INACTIVE` until approved |
| Reflex recommendations | `/api/clinical-rules/reflex` | `INACTIVE`; never auto-order/auto-bill |
| Autoverification policies | `/api/clinical-rules/autoverification` | `INACTIVE`; no automatic release |
| Validation hold rules | `/api/clinical-rules/validation-holds` | `INACTIVE`; explicit review before enforcement |

Each card keeps the safety/explanatory text and gets an explicit **Create
Draft** button. Each form is mounted only while a `CrudModal size="compact"`
is open; compact forms scroll within a centered modal (approximately one-third
of desktop width; responsive/full-width on narrow screens).

All six request payload field names, defaults and original API endpoints
are retained. Authorization, branch scopes, clinical server validators,
transactional audit events and independent approval rules stay server-owned
and **unchanged**. The creation handlers now display field-preserving
server/network failures in the active dialog, prevent concurrent duplicate
submissions, and close only after a confirmed successful response. No
clinical draft is approved, automatically released or back-dated by the UI.

## Evidence and what is NOT evidenced

`tests/ux-clinical-governance-dialog-safety.test.ts` checks explicit
opening actions, correct modal-form nesting, bounded size, busy-state
dismissal guards, request/field parity, inactive server-side status,
audit provenance, and route manifest coverage.

The source inventory still reports all browser, responsive, bilingual,
keyboard, theme, role and branch walkthrough evidence as `NOT_EXECUTED`.
This package is **source and CI coverage, not visual screenshot acceptance**.
Real reviewer UAT for clinical rules (including effective dates/timezones,
error scenarios, formulas, analyzers, QC critical values and multi-branch)
is required before clinical GO. Issue #250 remains NO_GO.

No schema migration, real patient data, analyzer command, financial price,
reference interval, clinical result release, or historical report is changed.
