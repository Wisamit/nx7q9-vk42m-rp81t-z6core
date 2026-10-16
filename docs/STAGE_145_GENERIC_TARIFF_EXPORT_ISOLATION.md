# Stage 145 — Generic tariff export isolation (§87)

## Verified defect and threat model

Both the paginated configuration export and the transactional signed bundle export
previously constrained PRICE_LIST and PRICE_LIST_ITEM by organization/branch and
scopeType alone. A tariff carrying an explicit `sourceId`, `referrerId`, `clientId`,
or `contractId` could still satisfy an `ORGANIZATION` or `BRANCH` scopeType and
appear in a generic export despite the documented rule that client/contract/source/
referrer tariffs are private to their own governed paths. The package-item export
already had an explicit null filter, which did not protect the other two groups.

## Change

- Both export APIs now apply the same `genericCatalogPriceScope` predicate to
  PRICE_LIST masters and the nested `priceList` relation of test/package priced items.
- That predicate requires **all four** private identifiers to be null and allows
  only an organization-wide list without a branch, or a branch list for an
  explicitly granted active branch. The granted branch array is copied to avoid
  mutation after predicate construction.
- Existing catalog/pricing permissions, audit logs, signed transactional bundle,
  repeatable-read snapshot, CSV/XLSX review-only projections and clinical/financial
  non-activation remain unchanged.
- A static and unit safety regression checks both live export routes, and a
  MariaDB integration test checks cross-tenant, other-branch and mixed-identity
  private-tariff exclusion using synthetic records.
- Nothing is imported or activated, and released clinical/financial history is not
  modified.

## Limits and independent signoffs

This fixes one concrete confidentiality gap, **not** full field-by-field
configuration import/export/restore parity and **not** all of Master Scope §87.
Private client/contract tariffs are not exported by the generic catalog surface;
any dedicated governed backup/migration must independently support their
authorization, exact decimals, effective windows, approvals and audits.

Issue #250 remains OPEN for §§75/86/87/88 and actual UAT. Issue #265 remains OPEN
for the end-of-software interactive UI audit (all pages, centered modals, RTL/LTR,
organization theme/date/time settings, accessibility, mobile/roles/branches).
CI is not a clinical, financial or Hostinger-deployment signoff.
