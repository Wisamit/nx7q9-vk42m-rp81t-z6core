# Stage 103 — Atomic Review & Apply for Configured Specialty Result Workspaces

## Baseline and confirmed gap
- Base: merged Stage 102 `3b19d832e8d1aebe3545acc242d681312e245a90`; owner confirmed Hostinger successfully deployed.
- Existing Phase 6D and 6H already provide `STANDARD`/`SECTIONED`/`COMPACT_GRID`, configurable result sections (1–4 columns), per-component entry width/hints and bilingual report/entry presentation. This stage **does not claim those features were absent**.
- Remaining practical gap: per-test layout, each section and each component had to be updated through separate requests. Preparing a complex CBC/urine/stool/semen/coagulation workspace could leave partially configured layouts in place. No unified stale-review guard existed across all the steps.

## Delivered
1. `src/components/specialty-layout-batch-editor.tsx` in existing test details: edit planned sections (bilingual labels, column count, hints, display order), assign every active test component, set entry widths and bilingual guidance, select workspace layout. Works with **existing component codes**, no specialty hard-coded test names.
2. `POST /api/catalog/specialty-layout-batch` with `PREVIEW` (read only) and `APPLY` (requires `fingerprint`, `reviewToken`, exact `APPLY_REVIEWED_LAYOUT` and explicit UI acknowledgement). Every active component must appear **exactly once**; rejects unknown/inactive cross-test components, repeated codes, inactive section-code collisions, invalid widths, and unknown section assignment.
3. Preview returns the actual layout and component impact and warns that new section groupings could affect future report snapshots; no automatic report suppression or renaming occurs.
4. APPLY serializes on the tenant-scoped test and its sections/components, re-reads the entire configuration under locks, rechecks live actor, role permission and active branch membership, compares the exact configuration fingerprint, rejects stale or altered review, and commits all affected configuration and one provenance-rich audit event atomically. Old sections not in the plan remain active and unchanged. No hard delete or override of released results, invoice snapshots or clinical reference intervals.
5. Reuses all existing tables; no database migration, no external provider secret, no new status. This stage is a governance and operator UX completion, not a new clinical interpretation feature.

## Checks
- Pure TypeScript safety tests: `tests/stage-103-specialty-layout-review.test.ts` via `npm run test:safety`.
- Real MariaDB two-connection integration: `tests/stage-103-specialty-layout-mariadb.integration.test.ts`, also called by CI, covers cross-tenant catalog boundaries, rollback, lock timing.
- Exact final feature SHA CI, merge with expected head, independent main SHA CI required.
- Human clinical sign-off of the configured specialty templates, actual operator entry workflows, report/print fidelity, analyzer instruments, and UAT remain deferred per owner instruction. This stage **does not provision actual CBC/urinalysis clinical parameter names or reference intervals**, which must be recovered from legacy catalog and clinically approved.

## Other work
- Draft PR #128 Analyzer Bridge, #209 historical duplicate, and #224 recall-quality follow-up queue untouched.
