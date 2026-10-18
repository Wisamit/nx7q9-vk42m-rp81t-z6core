# Stage 150 — Authorized catalog import discovery pagination

## Confirmed gap and implemented scope
The `/catalog` index had a fixed last-10 `CatalogImportBatch` list with no navigation. Private reviewed CSV/XLSX and signed JSON bundle batches older than ten entries could no longer be discovered through the catalog page after a reload. Stage 149's explicit UUID recovery action still works for an in-memory lost response; it does not solve historical browsing.

- Add `?importPage=N` bounded server-side page handling, previous/next AR/EN links and anchor navigation.
- Count and enumerate against **one canonical SQL/Prisma visibility predicate** rather than querying all imports then post-filtering.
- Keep author-private CSV/XLSX and bundle metadata, tenant isolation, active permissions for price and range data, and `catalog.manage` privilege fences from the previous implementation.
- Use MariaDB `RepeatableRead` transaction for count and page selection. If data shrinks, clamp to last visible page; use stable `createdAt DESC, id DESC` tie-break; retain 10 entries/page.
- Do not expose any import data to catalog viewers lacking `catalog.manage`. Keep existing author/financial/clinical scrutiny at batch detail page, separate from index disclosure.
- No new catalog activations, tariff changes, result changes, role modifications or schema migration.

## Verification
- Pure source tests: URL input normalization, bounds, empty/oversize pages, pricing/range/author scope, shared WHERE used by count/findMany and bilingual pagination.
- Real MariaDB **two independent connections**: 25 author-private CSV/bundle entries plus peer and foreign-tenant entries, three pages, no displacement by private records, consistency against concurrent inserts under repeatable-read. Stage 135 source privacy test adapted to the shared policy without weakening its assertions.
- CI: Prisma deploy/status/generate, TypeScript, ESLint, safety, MariaDB integrations, AR/EN/RTL/theme, Next.js production build. Merge only on exact feature SHA SUCCESS; require independent exact-merge-SHA main CI success.

## Remaining release/clinical gates
Issue #265 remains **OPEN**: full 81-route interactive AR/EN, RTL/LTR, desktop/mobile role/branch screenshot acceptance **NOT_EXECUTED**. A static source audit is not visual signoff.
Issue #250 remains **NO_GO**: qualified clinical/finance, analyzer/device, vendor interface and Hostinger backup/restore real-world UAT **NOT_EXECUTED**. Owner-confirmed Hostinger deployment of previous `ae70baea` does not establish deployment of this increment.
All 88 Master Scope sections remain active, with no scope removal or silent clinical/financial policy assumption.
