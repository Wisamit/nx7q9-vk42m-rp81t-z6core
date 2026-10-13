# Stage 115 — Current report staff-handover evidence in promised-delivery queue

**Base main:** `98831d9b6a8399dd3fe40b12782b8c365a544a2c` (Stage 114 deployed successfully on Hostinger, confirmed by owner). Independent main CI #1232: SUCCESS.

## Verified gap

- Master Scope §45 requires delivery tracking and logs; §80 preserves immutable report history and organization/branch separation.
- Stage 113 displayed whether the latest report was issued but not the staff-attested in-person handover evidence.
- Stage 114 introduced `OTHER/RECORDED` with an `STAFF_ATTESTED_IN_PERSON_HANDOVER_V1` audit evidence type and unique handover request key. The old follow-up queue could not distinguish an issued report with and without this event.
- The event is **only the employee's attestation**, not proof of patient signature/acknowledgement or independent verification of physical receipt. Do **not** infer receipt from browser print, PDF generation or provider dispatch.

## Implemented

1. Extended the existing `/orders/delivery-queue` (orders.view **and** reports.view, tenant/branch bound) with two filters:
   - `CURRENT_ISSUED_WITH_STAFF_ATTESTATION`: latest report version `FINAL`/`AMENDED` with a matching trusted, authenticated staff-handover audit record.
   - `CURRENT_ISSUED_NO_STAFF_ATTESTATION`: latest report version `FINAL`/`AMENDED` without such evidence.
2. A correlated EXISTS predicate on **current** `diagnostic_report_versions v` requires a `report_delivery_events` row for `v.id` with `OTHER/RECORDED`, `PATIENT`, actor ID, non-null handover request ID, and `STAFF_ATTESTED_IN_PERSON_HANDOVER_V1` JSON evidence type. An older final version's handover never supplies evidence for a subsequent amended version; retracted/partial current versions cannot satisfy either issued-only filter.
3. Strict validation of allowed status and branch; all user-controlled values bound. The same authorized organization/branch and query predicates drive count and page, stable ordered pagination, and no full report content/patient demographics are retrieved.
4. Bilingual queue column explicitly reads `Staff attestation recorded; patient receipt not independently verified` or `No in-person staff attestation for current report version`. For pending/non-issued versions the column reads `Not applicable`, never a misleading delivery failure.
5. The original broad `CURRENT_ISSUED`, `PENDING`, `OVERDUE`, `DUE_SOON`, `FUTURE` and `ALL` behavior is preserved. Existing Stage 114 route and append-only audit behavior remain untouched.
6. No schema migration, new delivery writes, automated communication, false `DELIVERED` event, receipt certification, clinical-result amendment or release action.

## Automated evidence

- Stage 115 safety tests validate strict filters, scoped parameter-bound EXISTS and NOT EXISTS, exact event evidence type, same predicates for counts/pages, security/permission guards and explicit multilingual distinction from patient receipt.
- Stage 115 real MariaDB integration covers current final/amended with staff attestation, amended current version with **only older** version handover, retraction of an older handed-out final report, print-only events, unkeyed OTHER events, cancelled order, no patient promise, other branch, foreign organization and count consistency.
- Full existing CI: Prisma migration validation, all safety suites, MariaDB, TypeScript, ESLint, localization/theme/accessibility checks and Next.js production build.

## Acceptance/release

- [ ] Exact-head feature CI SUCCESS
- [ ] PR reviewed and merged with expected HEAD SHA
- [ ] Independent main CI SUCCESS on exact merge SHA
- [ ] Owner confirms Hostinger publication
- [ ] Real patient receipt and signature workflows, permission/clinical UAT and printed paper handling remain DEFERRED by owner until final LIS acceptance

## Important limitation

An absence of `STAFF_ATTESTED_IN_PERSON_HANDOVER_V1` means **no qualifying staff attestation is recorded for the current report version**, not that the report was never emailed, downloaded, handed to an authorized third party, or otherwise delivered. An existing attestation still does not constitute independent patient receipt evidence.
