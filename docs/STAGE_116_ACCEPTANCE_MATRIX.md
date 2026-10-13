# Stage 116 — Controlled panel, commercial package and package tariff export

**Source revision:** `main` a7043e8934ae7c137faca56dd5607533901f95b2 (Stage 115, independent CI #1235 SUCCESS). No claim about owner deployment of Stage 115 in this document.

## Verified gap

- `02_MASTER_SCOPE.md`: configuration-driven catalog, reusable panels/profiles, commercial packages, price inheritance, audited exports, branch-scoped permissions and historic financial consistency.
- `/api/catalog/configuration-export` and its signed atomic `/bundle` previously covered TEST, COMPONENT, UNIT, REFERENCE_INTERVAL, PRICE_LIST, PRICE_LIST_ITEM. Existing TestPanel, CommercialPackage and PriceListPackageItem definitions could not be included, although all three are live catalog entities.
- Stage 116 is deliberately **export-only**, not a package importer or modification of existing orders, billing or clinical records.

## Implementation

1. Three new export groups: `PANEL` (TestPanel with complete ordered test members and required flag), `PACKAGE` (CommercialPackage with complete ordered test members), `PRICE_LIST_PACKAGE_ITEM` (historical, effective-dated commercial package prices as exact Decimal values).
2. Both paged read API (250-row keyset) and signed transactionally consistent bundle support these groups; selected contents use the existing access-controlled organization, authorized department and branch scope. The signed bundle retains size/row limits and audited source attestation.
3. **All-or-nothing clinical membership:** a panel/package is exported only when at least one member exists and **every** member is in the authorized test set. No partially exported package that silently omits restricted constituent tests.
4. Package-price exports require `pricing.manage`, only public organization or authorized branch price lists, and exclude client, referrer, source and contract-specific scopes even when linked unexpectedly. Every price retains original currency and exact decimal/effective dates. No implicit currency conversion.
5. Bilingual export interface exposes panel/package choices and only offers package pricing when the staff member has the financial permission.
6. No database migration, no background outbound delivery, no data modifications, no automatic activation of imported definitions and no alteration to historical results, invoices, units or prices.

## Automated acceptance

- Static tests: new types present in both endpoints and UI, authorized all-member query, full membership metadata, audited export, signing/size bounds, price-specific permissions, exact decimals.
- Real MariaDB: two authorized/restricted departments in distinct branches; full vs mixed panel/package membership; company, branch and client prices; exact four-decimal currency pricing.
- CI gates: Prisma migration/status and generation, all prior tests, Stage 116 safety + MariaDB, TypeScript, ESLint, RTL/i18n/theme, Next production build.
- Manual UX/UAT, original MDB specialty migration parity, real import/review workflow of new composite record classes, backup and restore tests **DEFERRED** until overall acceptance. Exports are *not* considered approved imports.

## Release checklist

- [ ] Final feature exact-head CI SUCCESS
- [ ] PR marked Ready and merged with expected SHA
- [ ] Independent `main` CI SUCCESS on exact merge SHA
- [ ] Owner-managed Hostinger deployment confirmed separately
