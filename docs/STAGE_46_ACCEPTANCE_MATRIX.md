# Stage 46 — Native Configuration Bundle Review Staging (Strictly Read-Only)

**Starting baseline:** Stage 45 merged `main` `e51566b3d94e96e44fa8f55be7452fd017cabc55`, CI #947 SUCCESS and owner-confirmed Hostinger deployment. Repository verified PUBLIC before modifications.

## Master Scope and why this exists

Master Scope §§7–8, 11, 17, 35, 87–88 requires reversible, controlled configuration migration, stable clinical/financial history and auditable import/export. Stage 24 exported six native JSON configuration groups, but there was no route to upload that exact `family-lab-catalog-bundle` format. Legacy MDB import accepts a different format and can commit selected masters, and CSV staging cannot round-trip exported structured JSON or original UUID links.

## Delivered

- New `POST /api/catalog/imports/bundle?sourceName=*.json` accepts **only the native v1 six-class JSON bundle** (TEST, COMPONENT, UNIT, REFERENCE_INTERVAL, PRICE_LIST, PRICE_LIST_ITEM); rejects invalid manifest, foreign organization, duplicate record UUIDs, missing clinical identity, unsupported/duplicate group types, invalid date/price strings and oversized input. The stream is bounded at 4 MiB, with at most 5,000 review records.
- Financial groups require `pricing.manage`; reference interval groups additionally require `catalog.reference_ranges.manage`; everyone requires `catalog.manage`, an authorized active branch and a valid department scope. Source must match the current organization. Every supplied test/component/unit/interval/price-list/item UUID must be a **currently authorized master**; reject stale/foreign or cross-branch/department records. Generic price scopes remain **organization and active branch only** — client, contract, source and referrer prices need separate governance.
- Preserve each exact source JSON record (including Decimal strings, effective dates, clinical intervals and name fields) in `CatalogImportRow.sourceData`, with a minimal, explicitly **non-committable** normalized review identity. Every row is WARNING, batch remains DRAFT, `validatedAt = null`, summary marks `reviewOnly`, `paged-live-not-atomic`. Audit logs counts, not protected values.
- Current six-category export now also restricts generic prices by `scopeType` and branch; a branch-null CLIENT/CONTRACT list is *not* a general organization-wide list. Exporting reference intervals now needs the dedicated clinical range management permission.
- Existing mutation routes (`commit`, `revalidate`, `mappings`, `prepare-units`, `reference-ranges`) reject `CONFIG_BUNDLE_REVIEW` before catalog/clinical changes. Existing CSV-only component and price reconciliation endpoints reject this new format rather than misinterpreting its fields. Batch page requires the original uploader and revalidates current permissions/branch/department/list scope before presenting source candidates. All clinical, price activation, safe import and revalidation UI actions are disabled for JSON bundle review.
- Adds a bilingual file-upload surface on the catalog screen; explicit warning that uploading **does not restore, approve or activate anything**.
- No Prisma migration or new table, no amendment to released values, invoices, approved ranges, original master IDs or prices.

## Automated acceptance

- `tests/stage-46-catalog-bundle-review.test.ts`: the six native shapes, no Decimal coercion, rejection of foreign/malformed/stale/duplicate/oversized forms, distinct pricing and range permissions, private financial scope, source-only persistence and guard coverage across all legacy mutation routes and UI.
- `tests/stage-46-catalog-bundle-review-mariadb.integration.test.ts`: two independent MariaDB connections; two organizations, two branches/departments, private CLIENT and scoped BRANCH price lists, real test/component/reference/price rows, authorized query checks, persistence of DRAFT/WARNING snapshot with no imported IDs, and unchanged live clinical reference/price values. This is database-backed source/handler policy testing, not a full authenticated HTTP browser test.
- Wired suite to CI alongside existing 45 stages' gates. Acceptance requires complete SUCCESS on exact PR feature HEAD and independent exact final merged `main` SHA (migration/status/generation, safety, all MariaDB, typecheck, lint, i18n/theme, Next build).

## Deliberate omissions, NOT scope removal

This is a **review/staging foundation** and must never be described as live six-class configuration import, clinical/financial approval or restorable backup. It intentionally requires a current same-organization UUID master to protect access while reviewing an existing export. Genuine **cross-organization migration, de-duplication, matching/revision, governed clinical approval and staged price activation** remain for future stages. Excel `.xlsx` and arbitrary legacy mapping remain open Master Scope work. Export is paged-live and **not transactionally consistent**. Inactive/historical source entries may require separate reviewer remediation. Analyzer Bridge PR #128 remains Draft/unmerged.

Manual clinical, financial, physical analyzer/scanner/printer, real-provider and end-to-end UAT is **DEFERRED until full system implementation** per owner instruction, not passed or waived. Hostinger deployment and live backup/restore must be confirmed independently after exact-main CI. All 88 Master Scope sections remain binding.
