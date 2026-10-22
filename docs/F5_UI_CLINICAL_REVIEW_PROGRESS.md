# F5 — whole-product UI engineering closure, incremental checkpoint

## Scope and evidence

This is an incremental source-level fix within the finite F5 phase, not a
claim that F5 is complete, that browser tests ran, or that any clinician/owner
signed off. Master Scope §1–§88 remains unchanged. The software UI inventory
comes from the actual CI `ui-full-surface-audit` artifact attached to merged
F3 main CI #2325 (source SHA `7709d016ba395bd7a6efb80ea35cec99eccbd04b`):
**81 routes**, 144 UI TSX components, 221 inspected source files, 15 possible
inline form source declarations, 2 non-compact modal sites, 4 `confirm()`
callsite candidates and 256 locale/date-time review callsites. These are
**static** inventory counts, not validated rendered-browser defects.

## Changes in this increment

- `src/components/result-entry-form.tsx`: the three *actual native*
  `confirm()` flows (initial technical-review request, server-demanded QC
  warning review and server-demanded delta-check review) now use the existing
  reusable compact, focus-managed, keyboard-accessible `CrudModal`. Close,
  Escape and explicit Cancel resolve **false**. An unmounted component cancels
  an outstanding prompt. No auto-accept or guessed clinical policy.
- The initial confirmation sets a busy guard before the dialog opens.
  Interactive save cannot race the in-flight confirmation. Each secondary QC
  or delta consent is prompted only after the server's *specific* challenge,
  and its corresponding `confirmQcWarnings` or `confirmDeltaWarnings`
  becomes true only after an explicit confirmation. Decline stops retries
  without claiming the review succeeded. Network interruptions during verify
  restore the action state and recommend refreshing the current result.
  Server clinical verification, independent medical validation and immutable
  release/amendment semantics are left unchanged.
- `src/components/staff-step-up-dialog.tsx`: retains password/TOTP and
  server-side step-up but uses compact modal width for consistency.
- `src/components/review-file-upload-dialog.tsx`: renames a *local* async
  staging handler called `confirm` to `stageSelectedFile`; it had been
  misidentified as a browser-native confirm by static text-only inspection.
  This is **not** a change to source file staging, consent or permissions.
- `tests/f5-clinical-review-modal-safety.test.ts`: checks the explicit
  clinical confirmation boundaries, restoration/cancel controls, server-side
  warning challenge and compact reauthentication behavior.

## Remaining work, not silently accepted

- The second noncompact dialog is the **large order-creation workflow**
  (`src/components/order-create-modal.tsx` size `full`). It includes
  multi-step patient, tariffs, billing and specimen decisions. Blindly
  compressing it risks selection errors. Proper progressive steps or a
  documented clinical exception require dedicated safe UX implementation,
  not CSS-only shrinking.
- 15 possible inline forms include nested forms rendered by parent dialogs,
  login/recovery, specimen handling, and time-critical result entry. Inspect
  actual rendered DOM and ownership before categorizing them. These are not
  automatically 15 violations. One recorded `confirm()` call in the static
  inventory was a local staging function, now disambiguated.
- All 81 routes still require AR/EN, RTL/LTR, theme, timezone, keyboard,
  responsive and role/branch-specific **actual browser** QA under F7 after
  F6 software completion. Synthetic code tests must never mark screenshots
  captured or owner signoff complete.
- No production patient, report, clinical signer, or qualified F8 device,
  privacy, tax or DR evidence is fabricated by this code-side improvement.

This checkpoint must pass exact feature HEAD CI, review safety/RTL/UI static
checks, MariaDB integrations and Next production build before any merge.
