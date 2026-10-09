# Stage 21 — Bounded and branch-scoped patient history navigation

**Base `main`:** `186c399740d45c8fddf431cf4caed913b79a1290` (Stage 20, CI #874 SUCCESS; Hostinger release confirmed by owner).

## Master Scope §4 and §44

The legacy history page rendered the complete merged-patient order collection, all released report-evidence snapshots, all report versions, all linked invoices and allocations, and an unbounded attachment target-ID enumeration on each request. Stage 21 replaces that eager all-history read with **five independently authorized history tabs**.

| Tab | Database window (20 + 1 sentinel) | Release and access semantics |
| --- | --- | --- |
| Orders | `labOrder.findMany`, stable `orderedAt/id` descending | Organization, linked identities, ordering branch, department-aware order item visibility |
| Results and trends | `diagnosticReport.findMany` for 20 accessible release-report records; derive current evidence and fetch only linked released results | Current non-retracted `resultVersionSnapshot`, tenant, performing branch, test/department scope and per-report amendment protection |
| Report versions | `diagnosticReportVersion.findMany`, stable `issuedAt/id` | Organization, ordering and issuing branch, linked patient and department-aware order access |
| Invoices and payments | `invoice.findMany`, stable `issuedAt/id`; only allocations on these invoices | Organization, ordering and invoice branch, linked patient; original currency, credits, refunds and payments unchanged |
| Attachments | `$queryRaw` selecting only authorized polymorphic patient/order/result targets **before LIMIT/OFFSET** | Tenant and attachment branch; order's branch and linked patient; result performing branch, linked patient, department and exact current non-retracted report result pointer |

All tabs preserve organization-wide identity lineage without backfilling or overwriting original orders, invoices, clinical results or attachments. User-controlled `section` only selects a granted tab. Invalid `page` inputs fall back to page 1. `skip`/`take` and a 21st sentinel offer previous/next paging without misleading global counts. The displayed total is scoped to the **currently visible page**; the sentinel is not rendered.

Clinical graphing and result rows refer **only to the currently selected page of at most 20 released report records**, clearly stated in both languages. They must **not** be interpreted as the complete trend. The former print-label ambiguity is corrected: print applies only to the current result page. A complete historical trend/export requires a separate controlled clinical feature; none is inferred or silently truncated.

For performance, deep offset paging and independently changing datasets are not fixed historical snapshots. A future keyset cursor/anchored `asOf` design may be appropriate at very large scale. Some current report evidence records can produce no visible clinical values after branch/department/retraction filtering; the UI's notice and next-page navigation disclose the per-page release-batch semantics.

## Tests and security gates

- `tests/stage-21-patient-history-pagination.test.ts`: page argument validation, 20/21 boundary behavior and source guards on report release, branch/department conditions, SQL authorization-before-pagination and tab-permission gates.
- `tests/stage-21-patient-history-mariadb.integration.test.ts`: 2 real MariaDB connections, 2 organizations, 3 branches, 25 in-scope order and attachment records across both pages plus restricted and foreign rows; no silent loss from a fixed cap; duplicate-free retrieval and isolation.
- Existing Stage 19 current clinical revision tests and Stage 20 clinical comparison tests remain in CI.
- `.github/workflows/ci.yml` runs Stage 21 MariaDB as a required gate in addition to all previous safety/integration tests, TypeScript, lint, bilingual UI/theme checks and production build.

## Deliberate boundaries

- A tab's page is **not a complete all-time extract**; payments are those allocated to invoices on the selected invoice page.
- Identity aliases are combined within an organization; branch and department grants remain enforced per workflow.
- Result and attachment SQL reads depend on the exact current non-retracted report result revision; withdrawn or superseded revisions are not disclosed as current.
- No patient/doctor/corporate portal permission changes or electronic record edits.
- Analyzer Bridge PR #128 remains Draft/unmerged. All Master Scope §§1–88 still apply.
- CI and Hostinger deployment are separate gates. Manual browser, physical instrument, provider, clinical and end-user UAT remain **DEFERRED** until the complete application is implemented.
