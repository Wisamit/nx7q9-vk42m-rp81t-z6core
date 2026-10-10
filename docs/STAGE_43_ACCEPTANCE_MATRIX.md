# Stage 43 — Safe-Master Panel Membership Identity and Staging Eligibility

**Baseline:** Stage 42 owner-verified on Hostinger; merged main `a0bf473ead357a1f889951711d936fd0e6016c69`, exact CI #938 SUCCESS.

## Reproduced source risk

The legacy safe-master import transaction previously linked `test_panel_items` by looking up staged **test display names** in a map updated during the TEST import loop. Distinct tests can have the same name but different immutable IDs/codes; this map silently selected the last test. The subsequent membership loop iterated **all** staged TEST rows, including `ERROR`, `IMPORTED`, `SKIPPED` and otherwise ineligible rows, and could reuse a prior import's `importedEntityId` or a different row's same-name result. This could mutate a panel's clinical membership without a qualifying test source row. Existing panel codes were also reused without verifying the matching source display identity.

## Safe change

- New pure `src/lib/catalog-panel-membership.ts` isolates exact safe-master TEST eligibility (VALID or the one explicitly allowed GENERATED_TEST_CODE WARNING), source-row-ID resolution, panel alias tracking and duplicate link suppression.
- After a TEST is created, retain `stagedRow.id -> createdTest.id` inside the same atomic transaction; an existing test can be referenced only when the staged code resolves to it **and** its canonical display name matches. Ineligible, failed, processed or unresolved rows never provide a link, regardless of names or stale stored imported IDs.
- After a PANEL is resolved/created, register only successful safe-master panel code/name aliases; conflicting normalized aliases become ambiguous and cannot resolve to an arbitrary panel.
- Existing panel code with a differing display name is not used as a link target; the source PANEL row remains `SKIPPED` rather than modifying existing clinical content.
- Insert only de-duplicated `{ panelId, testId, displayOrder:0, required:true }` pairs computed from **eligible staged TEST rows with verified source-row IDs**, under the existing single-winner `VALIDATED -> IMPORTED` batch claim and transaction. Keep FK uniqueness and existing `skipDuplicates`; never remove existing panel membership.
- Preserve organization-scoped test and panel lookup, existing immutable importedRow IDs, audit, safe-master allowlist, deferred clinical/price import isolation and all historical reports.

## Verification

- Deterministic source/helper tests: identical test display names with different IDs, generated-code-only warnings, invalid and processed rows, absent row mappings, ambiguous panel names/codes, duplicate link dedupe and route wiring.
- **Two independent MariaDB sessions:** real staged rows with identical names and different statuses, two correctly resolved test IDs, a separate-tenant test, source-row ownership, transactional commit visibility, exactly two allowed panel memberships, unchanged source statuses and no off-tenant link. This fixture tests the pure resolution used by the import route, not an authenticated HTTP end-to-end request.
- New MariaDB test explicitly wired into `.github/workflows/ci.yml`; all existing billing, specimen, clinical, historical and pricing CI gates continue.

## Acceptance and exclusions

Only safe-master import linking is affected. No migration, retroactive cleanup, modification/removal of prior panel membership, patient result amendment, price posting, reference interval activation, cash flow or release. Existing clinical masters are never overwritten. Controlled review/remediation of any previously imported ambiguous membership remains a separate audited clinical governance decision.

Engineering acceptance requires SUCCESS of full CI on the **exact final PR feature SHA** and then on the **exact merged main SHA**. Hostinger deployment remains independently owner verified. Manual lab, multi-branch, barcode/printer, analyzer and full UAT remain **DEFERRED until whole product complete**. All 88 sections of `02_MASTER_SCOPE.md` remain in scope; separate Analyzer Bridge PR #128 stays Draft/unmerged.
