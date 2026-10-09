# Stage 30 — Atomic Legacy Import Claims and Clinical Replay Safety

**Baseline main:** `9d39c8b8237df56168a67207fbbfea419594ea7e` (Stage 29, exact-main CI #904 SUCCESS; Hostinger deployment owner-confirmed).

## Audited defect

The legacy safe-master commit read `VALIDATED` batches but did not claim/change batch status inside its transaction, so concurrent imports could act on identical eligible source rows. Revalidation could reset already `IMPORTED` or `SKIPPED` rows to candidates and silently rewrite import validation provenance. Reference-range import performed clinical writes before claiming staged rows, leaving a concurrency window in which duplicate requests could create multiple draft clinical definitions from one original source row.

## Delivered changes

- **Atomic safe-master import:** `POST /api/catalog/imports/[id]/commit` refuses empty eligible-master batches, and the same transaction claims the batch by a conditional `VALIDATED -> IMPORTED` update with `importedAt` and `organizationId`. A concurrent second claim sees zero rows and receives 409; failure rolls back the batch claim and all master changes. Deferred reference-range and price/component rows stay unchanged; `IMPORTED` on the batch denotes the **safe-master portion of the import**, not full clinical completion.
- **Immutable revalidation:** `POST .../revalidate` denies `IMPORTED`/`FAILED` batches, processed rows and imported entity links. It rechecks an optimistic batch updatedAt/status claim **inside** the transaction, and conditionally updates each still-unprocessed row. Concurrent clinical or safe-master claims cannot be reversed by stale revalidation.
- **Clinical row serialization:** `POST .../reference-ranges` conditionally updates each eligible `VALID`/`WARNING` source row to `IMPORTED` **before** changing the test, creating a component, or creating its reference interval. Only the first claimant may create it. A failing transaction undoes both the claim and clinical writes. Resulting reference intervals remain `INACTIVE`, `approvalStatus: DRAFT`, with `importedEntityId` traceability; never auto-release.
- **CSV_REVIEW isolation:** reference-range write, legacy unit materialization and global legacy alias-mapping mutation routes reject CSV review batches. The CSV review page does not render the legacy reference-range import action. Existing safe-master and revalidate CSV guards remain.
- **Tests:** `tests/stage-30-import-atomicity.test.ts` verifies route contracts and clinical write ordering. `tests/stage-30-import-atomicity-mariadb.integration.test.ts` exercises independent MariaDB sessions, overlapping row claim, one inactive/draft interval, rollback recovery, and one-winner batch claiming. Integration added to GitHub Actions CI.

## Explicit restrictions and remaining work

- No new release/approval path for clinical intervals. Any approved reference interval/critical threshold still follows independent clinical approval and effective-date governance. No existing approved/released range/result/report or historic invoice is overwritten.
- The current safe-master transaction status `IMPORTED` represents only **that safe-master step**. Full batch-wide import progress and per-entity tracking need further explicit workflow design; price/component clinical/finance review-only batches cannot commit.
- Concurrent imports for **different** batches targeting clinically equivalent ranges remain a separate conflict/governance concern. This stage only guarantees **single-winner source-row claims** and safe-master batch replay protection. Clinical overlap validation remains required for approval.
- All 88 Master Scope sections remain binding; Analyzer Bridge PR #128 remains independent, open Draft. Manual lab, device, clinical/financial UAT, performance and Hostinger deployment confirmation are not implied by CI and remain deferred.
