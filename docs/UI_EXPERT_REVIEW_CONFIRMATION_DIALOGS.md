# Independent catalog audit reviews — confirmation dialogs

## Scope and risk

Issue #265 requires compact, center-screen responsive add/edit and other
mutation dialogs across AR/EN and RTL/LTR, without compromising clinical
safety or losing entered state. Three existing catalog governance surfaces
still sent nonbinding audit-write requests directly from table buttons or
inline page controls:

1. The **source author's signed-bundle drift referral** sends
   `POST /api/catalog/imports/[id]/bundle-drift` with row number, reason
   and an observation token.
2. The **independent clinical/financial expert** sends
   `PUT /api/catalog/imports/[id]/bundle-drift` with a flagged event and
   `CONFIRM_FINDING` or `RETURN_FOR_CORRECTION`. It must verify the
   current evidence before any decision.
3. The **separate independent policy draft reviewer** sends
   `POST /api/catalog/imports/[id]/policy-review` with domain, outcome
   and a structured revision reason. A proposal comment is not a
   signature or policy activation.

## Implemented

- All three use the existing portal-based `CrudModal` with `size="compact"`,
  a third-of-desktop-width layout, mobile fallback, RTL-safe logical
  spacing, Escape/focus trap, accessible labels and AR/EN messages.
- Clicking a drift referral or expert disposition **opens a confirmation
  preview**, never sends a write. Only the explicit final button submits.
  The preview identifies the relevant row, type, domain or reason; drift
  data shows changed **field names**, not sensitive old/new values.
- Independent expert decisions remain restricted to a row with current
  `READY` inspection. Its pending event ID and intended disposition
  must still match at submission; an error drops the pending request and
  invalidates the prior READY status to force an independent re-check.
- The full unsigned policy draft review and its seven policy topics,
  domain-specific structured objections and outcome selection have moved
  from a large page-level panel into a focused modal. The existing server
  remains the authority on separation of reviewers, current scopes,
  permissible values and event idempotence; a synchronous submission
  ref prevents duplicate button-click writes.
- All actions retain the existing API routes and verify the server's
  explicit `approved=false`, `activated=false`,
  `signingEnabled=false` where applicable, and `liveWrites=false`
  responses. Failures preserve an error/status notice. No clinical
  ranges or prices are auto-approved.
- Confirmed drift referrals trigger a refreshed comparison of the
  original page after the write. This is deliberately allowed while
  the row's `flagging` in-flight indicator is still active.
- Source-based CI regression asserts that table buttons can only
  stage an intention locally and that the mutating API call remains
  behind the modal's confirmation, retaining bilingual protections.

## Acceptance boundary

No actual browser walk-through is claimed: Issue #265 requires manual or
automated rendered testing on **private synthetic staging** for desktop,
mobile, keyboard, Arabic/English, branch/user scopes and any sensitive
confirmation failures. This remains **NOT_EXECUTED**. The overall clinical,
finance, hardware and disaster recovery gate remains **NO_GO** under Issue
#250. Master Scope §§75/86/87/88 are not silently signed off. No real
patient records, clinical images, secrets or legacy MDB transactional data
were introduced into this public repository.
