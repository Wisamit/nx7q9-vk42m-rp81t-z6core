# Stage 77 — Consistent Clinical History Report/Result Reads Under Concurrent Amendment

## Baseline and confirmed gap

- Baseline `main` SHA `60bef38dafd72b1b54448379ce3decd261ef51ad`, Stage 76 independent main CI #1051 SUCCESS, owner confirmed Hostinger deployed.
- Master Scope requires immutable released history, reliable amendment/retraction semantics, centrally merged patient history and branch-isolated clinical disclosure.
- Stages 71–76 enforce exact published report pointers, value, reference, tenant, patient, accession, branch, method and analyzer provenance in page and 250-report trends. However, the history page obtained `diagnosticReport.findMany` and `laboratoryResult.findMany` in **two independent database reads**, outside a shared transaction. A concurrently released amendment/retraction could commit between these SELECTs and yield a UI representation assembled from different database moments.

## Delivery

- Both queries now execute in **one Prisma interactive transaction** with MariaDB `RepeatableRead` isolation and a bounded 20-second database transaction timeout.
- Inside the same snapshot, compute the bounded report window, exact current pointers and full immutable published evidence, and query the corresponding live result/values. Filtering and assembling page-only cumulative tables and up-to-250-report trends happens on those coherently returned in-memory records.
- The original resolved merged patient scope and all tenant, authorized ordering/performed branch, department, result-status, reference, analyzer, method, numerical publication and history pagination checks remain. No new permissions are conferred.
- This avoids mixed-revision reads when a clinical amendment or report withdrawal commits **between the two history database queries**. The view is coherent as of the transaction snapshot, **not an assertion that nothing can change after that snapshot or before the page is viewed**.
- No modification of report version rows, released results, financial history or audit events, and no schema migration.

## Tests / required checks

- `tests/stage-77-history-repeatable-read-consistency.test.ts`: source-level safety check that both report and result SELECTs use the same transactional `tx`, bounded window, current immutable pointers, tenant/branch/department and value gates.
- `tests/stage-77-history-repeatable-read-mariadb.integration.test.ts`: two real MariaDB connections, one protected REPEATABLE READ clinical reader and a concurrent writer performing **version-append amendment** (13.5→14.5), then **version-append retraction**. It verifies in-transaction observations remain internally consistent while the next transaction sees the new amendment or retraction, with explicit original tenant/patient/ordering and performing branches in signed JSON.
- Dedicated Stage 77 MariaDB test is wired to CI alongside all existing clinical, multi-tenant, billing, migration, safety, lint, TypeScript, bilingual UI and production build checks.

## Limits / owner acceptance

- The merged-patient lineage discovery and unrelated non-results history sections are separate reads. Stage 77 specifically stabilizes the report-and-live-value clinical pair; it does not claim a full-page all-module serializable transaction.
- Long-lived client chart browsing still follows pre-existing current and bounded result windows. Cross-request freshness, real-world clinical signatory acceptance and analyzer/device UAT remain separately deferred.
- No new Hostinger environment variables, migrations or manual UAT required now. Owner must independently confirm successful production deployment of final merged SHA.
- PR #128 Analyzer Bridge remains OPEN/DRAFT and is not modified or merged.
