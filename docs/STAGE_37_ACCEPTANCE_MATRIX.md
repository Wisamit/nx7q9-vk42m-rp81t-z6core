# Stage 37 — Scoped CSV Reference Range Review UI and Non-Reviewable Row Redaction

**Base:** owner-confirmed Hostinger Stage 36 merge `337e156e460f825a6d930bc584685027c85689b2`; exact `main` CI #923 completed SUCCESS. Stage 36 remains a strictly advisory, read-only overlap comparison.

## Source audit and gap

Stages 34–36 implemented scoped, paginated, read-only reference-interval reconciliation plus staged duplicate, conflict and age-window warning signals. The existing catalog import details screen displayed raw staging rows but did **not** expose the dedicated reconciliation endpoint to clinical reviewers. As a result its new governance warnings were not accessible through the standard UI. The route also risked disclosing matched source/IDs for rows already `IMPORTED`, `SKIPPED`, or `ERROR` when stale validation metadata did not mark them blocked.

## Implemented

- Added `ReferenceRangeImportReconciliation` to CSV review import details only when `REFERENCE_INTERVAL` rows exist and the caller has reference-range management privilege. Existing server-side batch uploader, organization, active branch, department scope and catalog permissions remain mandatory.
- Explicit `Inspect`, `Next 100`, `Previous 100`, and restart controls. The client **replaces** each displayed page instead of retaining up to 20,000 source rows; a request error leaves the previous completed page intact. Fails closed if the endpoint ceases to advertise `liveWrites: false`, `clinicalActivation: false`, `approvalRequired: true` or violates the 100-row bound.
- Bilingual Arabic/English warnings for test/component/unit matching, duplicate/conflicting contexts and potential age-window overlap, with original issue codes visible for clinical reviewers. Unresolved candidates are not rendered when the endpoint redacts them. No approval, posting, mapping, import or activation actions were added.
- The clinical range reconciliation API now blocks and redacts every `ERROR`, `IMPORTED`, `SKIPPED` or otherwise ineligible row **before** matching. It returns null candidate, component, test and unit identities for those rows. Only `VALID` and `WARNING` source rows can reach exact clinical reconciliation.
- Added `tests/stage-37-range-review-ui.test.ts` for disclosure/read-only behavior and `tests/stage-37-range-review-mariadb.integration.test.ts` using **two independent MariaDB sessions** for authorization-gated batch lookup, paging/restart across row 100, eligibility and unchanged staged rows. New MariaDB regression is wired into `.github/workflows/ci.yml`.

## Acceptance boundaries

- Engineering acceptance requires exact feature HEAD SUCCESS on GitHub Actions (migrations, Prisma, safety, two-session MariaDB tests, TypeScript, lint, i18n/theme, production build) and exact new main SHA SUCCESS after reviewed merge.
- This is **review UI and protective read-only redaction**, not a medically validated clinical range import/approval system. Exact test and unit identity cannot approve overlapping sex, age, method, analyzer, specimen, branch, population or effective-date context. No clinical configuration, released report, financial price, invoice or historical snapshot changes.
- The canonical `CSV_REVIEW` source is not a round trip of the Stage 27 flattened review export. `.xlsx`, other master-data imports and full governed component/range/price activation remain open within all 88 Master Scope sections.
- Separate Analyzer Bridge PR #128 remains Draft/unmerged and must be audited independently.
- Owner-requested physical analyzer/printer/scanner, manual UI, clinical, security/provider and full end-to-end UAT remain **DEFERRED** until complete application implementation. CI cannot prove Hostinger deployment; the owner confirms deployed SHA.
