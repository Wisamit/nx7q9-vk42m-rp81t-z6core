# Large UI release gate package — Governed action modals and route exception audit

## Source baseline

- Confirmed owner deployment: `main cfe995c8ff093e08c2460e8f2709f230b88fd495` after screenshot-driven PR #284.
- This is one coherent, **large** UI/UX implementation package across **Patient Master, Staff Report Delivery, Laboratory Result Traceability, Organization Roles & Permissions, the shared modal, shared responsive styling and the exhaustive 81-route AST audit**.
- The prior 81/81 claim was **source-file inventory only**. This package does not claim real-browser acceptance; issue #265 stays OPEN until the required separate device/browser evidence and owner sign-off exist.

## Changes and clinical/financial controls

| Domain | Change | Invariant |
| --- | --- | --- |
| Patients | Move formerly inline `PatientEditForm` to a button-triggered compact `CrudModal`, with native required fields, reason, accessible validation, and a separate explicit duplicate identity review confirmation | Active patient/organization authorization, CAS `expectedUpdatedAt`, duplicate review candidate evidence, auditor override reason and released diagnostic history unchanged |
| Staff report delivery | Move staff in-person handover attestation to compact modal; require patient number, identity verification method, explicit attestation; make successful status visible outside the modal | Does **not** become a patient signature; API and immutable handover idempotency request key retained; no handover without physical event |
| Result repeat/rerun | Move rerun/repeat event marker into an explicit compact modal with required reason; show prior audit instants through `SystemDateText`; handle network ambiguity with a safe re-check message | The marker does **not** change a result value, report version or QC policy; no automatic resubmission after ambiguous outcome |
| Roles and permissions | Replace only remaining oversized role-management `xl` modals with compact scrollable dialogs; add client-only bilingual permission search and readable category cards | Permission checkboxes and protected financial hidden grants **remain mounted while filtered**; exact existing `permissionIds` submission, server authorization, system-role restrictions and double-submit locks remain |
| Shared modal | Mark explicitly presentation-only dialog search boxes with `data-modal-ui-only`; do not trigger dirty-change discard confirmation from search/filter input | Actual edits, checkboxes and text changes continue to trigger guarded unsaved-change confirmation, focus trapping, Esc and focus restoration |
| Shared CSS | Responsive single-column role permission groups, accessible focus, readable labels and scrollable compact dialogs in existing theme tokens | Light/dark and RTL use existing system variables; mobile dialog remains bounded to viewport |
| Full-surface audit | Reuse existing TypeScript-AST `scripts/ui-full-surface-audit.mjs`, do not add a duplicate naive regex scanner; record unresolved owner/clinical/security choices on inline forms | 81 canonical route paths stay intact; an explicitly unresolved exception is **not** approved. Browser review remains `NOT_EXECUTED` |

## Exclusions needing explicit acceptance, not automatic exemptions

- Inline time-sensitive `phlebotomy-collection-card.tsx`, `bulk-result-entry.tsx` and `result-entry-form.tsx` need a **qualified clinical and owner decision** before forced conversion into a small dialog; a too-small viewport during patient identification/result entry can compromise safety.
- Authentication and portal identity flows `staff-login-form.tsx`, `portal-login-form.tsx`, `portal-change-password-form.tsx`, `portal-contact-verification.tsx` require explicit privacy/UX decision before strict modalization. These are not the same as administrative CRUD edits.
- The AST tool still reports all unknown inline forms as `MANUAL_DOM_CONTAINMENT_REVIEW_REQUIRED`; an imported child form can be contained in a parent modal. Do not equate a source grep with visible browser behavior.

## Evidence and release gates

- Added `tests/ui-large-governed-action-dialogs.test.ts`, checking patient CAS and duplicate review, handover idempotency/physical policy, repeat event immutability and network ambiguity, role financial permission preservation, scoped modal CSS and the audited 81 route set.
- Existing `npm run test:safety` plus real MariaDB integrations, TypeScript, ESLint, theme/i18n, full UI AST audit and Next.js production build must pass on the feature HEAD.
- Merge with exact expected HEAD SHA, then separately verify independent CI on the resulting `main` SHA.
- A successful CI is **not** a real UI rendered screenshot. `browser_review` remains skipped until there is a secure staging browser, fixture accounts, and role-scoped test data. Owner final visual signoff (issue #265) and human/device/finance/DR release signoff (issue #250) remain **OPEN / NO_GO**.
- No Prisma migration or changes to patient identifiers, released clinical reports, price/tax computations, sample chain of custody, doctor access permissions or integration vendor data.
