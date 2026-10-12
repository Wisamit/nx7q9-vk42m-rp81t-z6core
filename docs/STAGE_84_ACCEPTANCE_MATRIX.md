# Stage 84 — Controlled Legacy Clinical Comment Template Migration

## Scope and verified gap

Baseline: merged Stage 83 main `d3242fb678d5400d2989bdc3a99cadef96f7ec7a`, independent main CI #1067 success and owner-confirmed Hostinger deployment. Master Scope §§37, 80, 87–88 include reusable historical comment templates. The live code already supports managed ResultCommentTemplate and recorded result comments, but Stage 82/83 reviewed CSV importer had no clinical comment template kind. This stage reuses that existing model and UI rather than adding test-specific tables or reinterpreting existing patient data.

## Operator workflow and safeguards

- `/catalog/legacy-master-data` offers `COMMENT_TEMPLATE` only with both `catalog.manage` and `result_comments.manage` plus active, authorized branch scope. The API enforces the same checks.
- Exact UTF-8 CSV columns: `code,name_en,name_ar,text_en,text_ar,scope,test_code,component_code`. Scope is **explicit**: `ORGANIZATION` requires both target codes blank; `TEST` requires `test_code` and blank component; `COMPONENT` requires both. No guessing names, test codes, link ownership or clinical interpretation.
- Strict CSV parsing with quoted multiline text, BOM and Arabic, normalized unique code, 200-row / 64 KiB maximum, nonempty English name/text and controlled lengths. Target test and component codes are looked up in the same organization and must be ACTIVE, with each component belonging to its nominated test. Stale or cross-tenant target mappings fail the entire batch.
- Read-only `PREVIEW` displays the full original clinical text and scoped links; confirms within-tenant code conflicts and a tenant + kind + rows SHA-256 fingerprint. `APPLY` requires the matching fingerprint and the separate `CREATE_INACTIVE_COMMENT_TEMPLATES_ONLY` acknowledgement.
- All writes use the existing `Serializable` transaction with live uniqueness re-check, scoped active target re-resolution, `createMany` and both grouped and per-record audit events. Duplicate IDs/codes, removed targets and concurrent conflicts cause complete rollback, never partial application.
- **All imported comment templates are explicitly `INACTIVE`** and carry a deactivation timestamp. This prevents unreviewed historic interpretive language from appearing in clinical result entry or issued reports. A separate authorized existing clinical comments workflow must review and activate them; importing grants no signature authority or policy approval.
- No change to existing templates, report templates, clinical results/values, released versions, amendments, prices, invoices, client contracts or financial history. Existing Stage 82/83 fingerprint content for their original kinds is preserved.

## Automated acceptance

- `tests/stage-84-legacy-comment-template-safety.test.ts`: bilingual/multiline/CSV parsing and rejection, exact scope/cross-tenant target resolution, non-active persisted status and consent/permission/write-path assertions.
- `tests/stage-84-legacy-comment-template-mariadb.integration.test.ts`: actual MariaDB with two connections and Prisma transactional writes, scoped component IDs and bilingual inactive values, durable audit, other-organization false mapping rejection and atomic duplicate-code rollback.
- Dedicated MariaDB test added to `.github/workflows/ci.yml`; existing safety suite, Prisma migrate/status/generate, TypeScript, lint, UI i18n and production build remain in CI.

## Delivery boundaries

No Prisma migration, env-var addition or automatic MDB ingestion. Existing approved/test-specific clinical interpretation policies, comment revision governance and eventual real-world operator UAT are **not** activated or asserted by this import. The source Access `Comment` table still requires review and mapping into the normalized CSV by authorized lab staff before use. A production backup and deployment verification on Hostinger remain separately owned. No live clinical patient data should be added to this public repository. PR #128 Analyzer Bridge remains draft/unmodified. Full 88-section Master Scope retained.
