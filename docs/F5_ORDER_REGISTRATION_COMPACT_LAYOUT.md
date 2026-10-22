# F5 — compact, guided order registration (source-level change)

This increment builds on merged F5 PR #339 and the 81-route static UI inventory.
It does **not** reclassify source inspection as hands-on browser acceptance.

## Problem and approach

The remaining `OrderCreateModal` used `size="full"`, which contradicted the
product owner's centered, roughly one-third-desktop-width modal policy.
Unlike a cosmetic field editor, order registration can create both laboratory
orders and invoices and carries patient identity, branch, requisition, selected
tests and packages, discounts, test-specific clinical questions and specimen
workflow decisions.

To avoid introducing unsafe conditional validation, this increment uses a
**guided vertical single-column flow**, rather than hiding required fields
behind form steps. Native required inputs remain in the same mounted form;
`FormData`, `onSubmit`, server-side order and billing permissions and
original discount approval behavior remain unchanged. The existing
`CrudModal` retains its scrollable height, focus trap, Escape handling,
dirty-form confirmation, bilingual text and RTL/LTR support.

The form adds sections for patient/ordering context, test/package selection,
billing/discount and conditional clinical questions; a final in-form review
summarizes the selected patient identifier, test codes, package codes and
discount amount, while explicitly reminding operators to verify the selected
branch, clinical questions and billing client in the form above. This summary
is *not* an authoritative calculated price or a substitute for the server's
invoice snapshot. Branch and client values are not guessed from master data.

Styles are scoped to `order-modal-compact-flow` and use the organization's
existing CSS theme tokens. The nested result-question grid and inline package
search are single-column to avoid horizontal clipping.

## Clinical and financial invariants

- The API request, patient identity selection, branch, priority, doctor
  requisition immutability, package/test overlap checks, pregnancy context,
  discount manager approval workflow, clinical answer requirements,
  transactional order+invoice creation and server-side branch permissions are
  intentionally unchanged.
- No test definitions, prices, critical thresholds, clinical interpretations,
  timestamps or previously released results are changed.
- No hidden or inert required inputs; no auto-approval, and no inferred
  workflow completion. The real modal remains reviewable in keyboard/RTL/
  screen-reader/browser acceptance.
- Source tests are in `tests/f5-compact-order-creation-review.test.ts`.
  Exact feature HEAD CI and independent main CI are required for promotion.

## Still blocked for release

This is a source-level safety-minded UI implementation, **not** screenshot
evidence. Real F7 browser acceptance must assess all canonical routes,
including this dialog on desktop, tablet, mobile, Arabic/English, different
organization palettes, keyboard-only and screen-reader access, empty/large
test panels, discounted/approval flows, and duplicate-patient prevention.
F8 qualified clinical, device, tax and operational go-live remains NO_GO
until documented sign-off.


## Ambiguous create response: duplicate-order defense

The review uncovered a separate clinical/financial hazard in the same form:
after a connection interruption, a user could previously submit again before
checking whether the original order and invoice had already committed.
The original local warning alone did not stop the duplicate action.

`OrderCreateForm` now latches ambiguous outcomes, shows a bilingual
`role="alert"` warning and disables registration in the current form session.
Ambiguity includes a network error, HTTP 5xx, missing/unstructured error
response, or HTTP 2xx lacking an accession number, invoice number, currency
or total. It never claims success on a malformed 2xx receipt. The operator
must preserve the entered data, reload and reconcile existing Orders/Billing
before starting a new submission. This **does not** claim exactly-once
delivery across different sessions/devices; eventual server-issued
idempotency keys and transaction/reconciliation controls remain separate
architecture concerns. The existing server transaction and approval
invariants are unchanged. Synthetic regression:
`tests/f5-order-ambiguous-receipt-safety.test.ts`.
