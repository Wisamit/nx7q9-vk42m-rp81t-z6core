# Stage 50 — Consistent, Live-Scoped Native Configuration Bundle Export

**Baseline:** Stage 49 merged main `8d8231ae1161df99d8dcca2e0cf6a67713da9281`; main CI #962 SUCCESS. The owner explicitly confirmed this exact SHA deployed successfully on Hostinger before Stage 50 started. The repository was checked PUBLIC before this branch was created.

## Gap addressed
The native six-class JSON export previously stitched 250-row pages from separate HTTP/database reads. A test, unit, reference interval or price might change between pages; access grants could also be revoked between calls. This produced a useful source snapshot, but not a consistent configuration view for future governed import decisions.

## Implementation and evidence
- Added `GET /api/catalog/configuration-export/bundle?types=TEST,COMPONENT,...` with one Prisma **REPEATABLE READ transaction** covering all selected groups. Reads are bounded to **5,000 combined records** and **4 MiB**, fail with HTTP 413 rather than silently truncate, preserve exact Prisma Decimal strings and original UUIDs, and order records by stable IDs.
- Lock the current active organization row before re-reading active branch grants, intersect them with the session's grants, recheck active department access, and apply the same clinical test scope used by staged bundle review. Generic prices are limited to `ORGANIZATION` and expressly authorized `BRANCH` lists; the endpoint does not export private `CLIENT` or `CONTRACT` price lists. Independent pricing/range permissions are required for those selected classes.
- Server audit event `CATALOG_CONFIGURATION_ATOMIC_BUNDLE_EXPORTED` records type, count, byte length and scope metadata without copying raw sensitive records into audit fields.
- JSON export UI now uses the single consistent API response; the existing CSV review-only path remains available. Both languages explain that this is a configuration export, **not** a full database/attachment backup or authorization to apply edits.
- Bundle review parser accepts both the historical `paged-live-not-atomic` format and new `transactional-consistent-read` provenance. Stage 49 staging persists the truthful consistency marker; the non-atomic warning remains for historical bundles only.
- Both export and subsequent import **remain source-only**. Import batches stay `DRAFT`, staged rows `WARNING`. No components, units, tests, approved intervals, prices, invoices, reported clinical history, or user grants are activated or edited by this stage. The original safe-master commit route continues to refuse both JSON source formats.

## Automated engineering gates
- `tests/stage-50-atomic-catalog-bundle.test.ts`: atomic transaction/lock ordering, live branch/department authorization and fail-closed behavior, native format parsing, contract protections, scope redaction, 4 MiB/5k bounds and no clinical/financial mutation.
- `tests/stage-50-atomic-catalog-bundle-mariadb.integration.test.ts`: two **independent MariaDB connections**, one repeatable-read source transaction; concurrent direct test and price changes after its initial consistent read do not contaminate later reads; after commit new values are visible. Separately checks authorized branch-only price scope, excludes private/foreign rows, and proves revoked stored grants fail live read.
- Dedicated MariaDB suite added to `.github/workflows/ci.yml`; previous safety, other MariaDB suites, Prisma migrations/generate, TypeScript, ESLint, bilingual theme/i18n and Next.js build remain required.

## Explicit boundaries and remaining scope
- A consistent tenant/permission-scoped **configuration** read is not a full, atomic DB/attachments disaster-recovery backup, and cannot restore deleted records from other organizations.
- This does **not** authorize changing clinical ranges, critical limits, methods, financial prices, contracts, invoice history or released patient reports. Actual governed reviewed import/activation requires separate explicit clinical and financial sign-off models and effective-window conflict handling, without inventing approval policy.
- The organization lock only coordinates writers using that convention; the repeatable-read snapshot protects consistency from unrelated committed writes **after the snapshot starts**, but the export does not freeze live operational activity.
- Larger catalogs exceeding 5,000 rows/4 MiB require a future bounded background snapshot mechanism, not an unsafe partial file.
- Analyzer Bridge PR #128 remains Draft/open/unmerged. All 88 Master Scope sections remain authoritative and no feature was removed.
- Manual UI, specimen/barcode hardware, physical analyzers, finance/medical UAT, provider security, final backup restore proof and clinical go-live acceptance remain **DEFERRED UNTIL THE ENTIRE IMPLEMENTATION IS COMPLETE**, not passed or waived.
