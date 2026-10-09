# Stage 29 — Financial Disclosure Boundaries for Catalog Imports

**Baseline:** `8f13a3d11c161fabb7f081b668d0be017279a57f` (Stage 28 merged, main CI #902 SUCCESS, Hostinger owner-confirmed).

## Audited gap

The catalog batch detail page was protected only by `catalog.view` while showing staged `PRICE_LIST_ITEM` amounts, candidate JSON, source identity, status summaries and warning codes. The general catalog page also displayed package prices from any current price-list scope to catalog readers. The legacy JSON staging API accepted financial rows under `catalog.manage` without requiring `pricing.manage`. The Stage 26 reconciliation endpoint could echo a staged price when its list mapping was unresolved or out of branch scope.

## Delivered safeguards

- Catalog import **detail** requires `catalog.manage`, and batches with priced rows additionally require `pricing.manage`, an active branch scope, and **every** staged price-list code to resolve to a current-organization list whose branch is organization-global or within the user's active scopes. All source values, counts and errors are loaded **only after** this gate. Unresolved/foreign-list batches fail closed with 404, not partially exposed.
- Financial legacy JSON staging now requires `pricing.manage` as well as `catalog.manage`; no direct price posting is authorized.
- Catalog home price column appears only for users having **both** management permissions. Queried illustrative package prices are limited to organization/branch price lists within authorized active branch scopes; client/contract negotiation prices are not offered as general catalog defaults.
- Batch discovery on the catalog page is hidden for non-managers. Catalog managers without finance permission see non-price batches only; finance managers may additionally see their own price-containing batches. The detail-page branch gate still applies.
- Stage 26's price reconciliation redacts **all candidate monetary/test/date fields and validation metadata** for unknown, foreign or out-of-scope price-list mappings. It still reports a generic blocked reason, with no raw amounts returned.
- `src/lib/catalog-import-disclosure.ts` implements the fail-closed mapping check. No migration, no change to historical invoices, reports, prices or staged clinical data.
- Source and unit tests: `tests/stage-29-import-disclosure.test.ts`. Real two-session MariaDB: `tests/stage-29-import-disclosure-mariadb.integration.test.ts` verifies tenant and branch isolation across three same-organization price lists plus a foreign-tenant list. Wired to `.github/workflows/ci.yml`.

## Caveats / incomplete requirements

- Existing staged batches whose price-list mappings are unresolved will be hidden until referenced lists and authorized branch scopes are configured. No silent re-mapping is attempted and no data are deleted.
- This increment does **not** establish a financial approval or posting workflow. Actual price imports and clinically governed component imports require independent policy and audited versioning. Review-only statuses confer no approval.
- Catalog configuration privileges still need a full cross-module permission assessment before production; branch/department policy must be validated against real organizational governance.
- All Master Scope §§1–88 remain authoritative. Analyzer Bridge #128 stays Draft/unmerged pending independent review.
- Automated CI does not replace deferred clinical, finance, device, UI, security, privacy or backup acceptance. Hostinger deployment confirmation remains separate.
