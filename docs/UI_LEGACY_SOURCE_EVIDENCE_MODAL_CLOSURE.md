# Issue #265 — Access source coverage and specialty evidence review dialogs

Owner-confirmed deployed baseline: `349693f8648221f625ef0b09b6036ca3454de7e9`.

## Source-reviewed gaps

- **source coverage:** the old file picker was hidden and programmatically triggered from an inline button. Its file-selection `onChange` immediately POSTed a selected JSON manifest to `/api/catalog/legacy-source-coverage`, which creates a review audit event. The operator never received a distinct pre-upload choice or confirmation.
- **specialty reference evidence:** the selected legacy table and visible JSON file picker lived directly on the page; the file-selection `onChange` immediately read the file and POSTed full parsed evidence to `/api/catalog/legacy-specialty-evidence`. The table choice is only a structural filter, not a clinically confirmed test relationship.

## Implemented

A shared `LegacyEvidenceReviewDialog` now provides a centered, compact (one-third desktop) modal for both procedures with explicit local file selection, file/type/size checks, clearly stated review-only boundaries, cancel, and deliberate **Confirm evidence review**. Selecting a file or a table does **not** automatically read or POST it. The file and optional source table remain in the locally controlled dialog until confirmation. Modal focus and unsaved-change safeguards use the existing shared foundation. A synchronous submit guard and disabled controls prevent double submissions. Success closes and resets the file; failure leaves the review dialog open with feedback.

- **Coverage:** accepts only local JSON metadata manifests up to 64 KiB. The existing endpoint still validates permissions, organization-wide scope, current branch, deidentification shape, source/candidate counts and writes a review **audit**. It never certifies original MDB bytes, individual row identity, tariff parity, reference limits or cutover. Client output additionally fails closed on any implied positive certification.
- **Specialty:** accepts a local JSON evidence file up to 6 MiB and requires explicit selection of one of the ten known table names inside the dialog. This does not infer a clinical test-to-table link. Existing server rules validate permitted test/component scope and return only a structural comparison. Client output rejects unexpected clinical approval, reference import, layout application, or mismatched source table.

No API contract, database migration or historical clinical/financial data were modified. These are UI safeguards only, not an independently verified original MDB source. Local `scripts/legacy/export-source-coverage.ps1` and `scripts/legacy/export-specialty-reference-evidence.ps1` remain the authorized metadata/evidence extractors; do **not** upload an Access database or patient/order/result extracts. The review request may generate a governance audit event, but neither path alters live clinical reference intervals, imports values, or signs clinical assessments.

## Verification

`tests/ui-legacy-source-evidence-review-modals.test.ts` guards the explicit-confirmation interface, synchronous duplicate safety, no auto-submit on file selection, English/Arabic prompts, source size limits, saved server authorization and audit, and immutable clinical/financial output flags.

**NOT_EXECUTED:** browser-interactive verification for all roles/branches, real source export and exact MDB row-by-row matching, clinical reviewer sign-off, mobile keyboard/zoom and all 81 route screenshots. **Issue #265 OPEN** and **Issue #250 NO_GO** until qualified acceptance evidence. Source comparison counts are **not proof** of clinical or financial parity. Full target master scope (88 sections) remains intact.
