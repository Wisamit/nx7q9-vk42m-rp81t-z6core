# Issue #265 — shared modal overlay and keyboard safety hardening

## Verified starting point

The product already includes `CrudModal` and a one-third desktop
`compact` width policy, plus a route inventory of 81 screens. The existing
modal mounted inside its invoking component tree, could be clipped or
rendered behind a transformed/overflow-hidden ancestor, and assigned
`document.body.style.overflow` separately in every instance. Closing the
underlying dialog out of order could restore scrolling while another
dialog was still open. Keyboard Tab/Escape stayed in the topmost dialog,
but programmatic focus or mouse-induced focus changes were not redirected.

## Changes

- Render the open dialog overlay through a React portal attached to the
  document body, outside layout-specific overflow/stacking contexts.
- Reference-count scroll locks by body. Preserve the original inline
  overflow value and restore it only when the final modal closes;
  cleanup is idempotent for React Strict Mode.
- Add a capture-phase `focusin` boundary for the topmost dialog.
  When unsaved-change confirmation is visible, the confirmation alone is
  the focus boundary. Preserve the existing Tab wrap, Escape behavior,
  unique heading/description IDs and initial/final focus restoration.
- Delay focus restoration until the closing portal has unmounted, so its
  own old focus boundary cannot reject returning focus to the launcher.
- Default new shared `CrudModal` instances to `compact`; screens that
  explicitly request another size retain their existing layout pending
  route-level clinical/accessibility review. Existing compact CSS preserves
  approximately one-third desktop width, responsive mobile layout and
  internally scrollable content.
- Set the underlying header/body `aria-hidden` while the localized
  unsaved-change alertdialog is shown. Changes inside a nested portal
  do not mark the parent dialog dirty via React event propagation.
- Pure Node tests verify nested lock and idempotence; static safety
  regression guards the portal, keyboard/focus, dirty-data and viewport
  requirements without pretending to replace browser evidence.

## Scope & verification limits

This does not change orders, lab results, accounting, specimen custody,
signature or clinical API behavior. The critical result-entry screen
currently has a direct form. Converting a time-critical clinical worklist
to a narrow modal requires an explicit owner/clinical workflow decision
under Issue #265; this PR intentionally does not silently alter that
workflow. Other route-inventory candidates still need individual
classification and interactive owner review.

CI source tests are not a rendered-browser accessibility audit.
The full 81-route desktop/mobile/RTL/palette/timezone screenshot and
interaction suite is still NOT_EXECUTED on qualified private synthetic
staging, and Issue #265 remains OPEN. Issue #250 actual clinical/finance/
device/backup restore UAT and signed GO/NO_GO also remain OPEN/NO_GO.
No patient records, medical results, secrets or staging screenshots
were added to the public repository.
