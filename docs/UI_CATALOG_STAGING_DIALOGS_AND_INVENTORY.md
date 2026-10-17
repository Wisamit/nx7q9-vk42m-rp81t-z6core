# Catalog review upload dialogs and the whole-route UX inventory

## Software changes

Three catalog import surfaces now use one explicit, reusable
`ReviewFileUploadDialog` component:
- cleaned legacy master JSON staging (32 MiB client cap aligned to server)
- canonical CSV / one-sheet XLSX clinical and financial review (2 MiB)
- signed configuration bundle JSON review (4 MiB)

The trigger opens the existing compact `CrudModal`. Selecting a file does
**not** start a network request. The operator must explicitly confirm.
The dialog keeps the file and displays errors on failed submission, prevents
double-submission, disables dismissal during active upload, and resets
selection on cancel or after success. It reuses the shared accessible dialog
focus trap / Escape / restore semantics and the current approximately one-third
desktop viewport width, responsive/mobile CSS and theme variables. Arabic and
English labels are provided. Downloads of read-only templates remain available
from the page.

This refactor keeps the original /api/catalog/imports, /csv and /bundle
endpoints and their tenant/branch/role checks and review-only limits. A UI
confirmation **never** grants clinical, price, catalog or activation rights.
No patient, invoice, result or historical report code changed.

## Canonical 81-route UI inventory — reuse, not duplication

This package **reuses** the already implemented and tested
`scripts/ui-route-form-inventory.mjs` and `docs/UI_ROUTE_MANIFEST.json`.
The existing TypeScript AST analyzer inventories **all 81 existing**
`src/app/**/page.tsx` routes, their domain, direct page forms, first-level
imported components/forms, `CrudModal` uses, and potential inline mutation
candidates. CI already checks its canonical manifest and emits a Markdown
form inventory as a build artifact. We do not introduce a second manifest,
weaker regex scanner or conflicting CI gate.

For current source evidence, run:
`node scripts/ui-route-form-inventory.mjs --markdown` or
`node scripts/ui-route-form-inventory.mjs --json`.

All routes remain explicitly `NOT_EXECUTED` for actual browser interaction,
AR/EN/RTL, mobile and per-role/branch verification. A first-level import
search cannot prove a nested/dynamic form's behavior. No qualified owner
or device/clinical acceptance follows from the inventory or CI alone.

## Remaining acceptance

Per Issue #265, inspect every registered route on **private synthetic
staging** with branch- and role-specific users, all organization appearance
/ time settings, desktop and mobile widths, RTL/LTR and real keyboard
navigation; migrate other confirmed inline mutations and record explicit
exceptions for time-critical clinical workflows. No credentials or
medical screenshots should enter the public repository.

Issue #250 real clinical/financial/vendor/DR acceptance remains NO_GO.
Sections §75/§86/§87/§88 require governed completion; neither the UI
manifest nor successful CI signs off any medical or accounting policy.
