# Issue #265 — governed legacy master import CSV and revalidation dialogs

Baseline `main`: owner-confirmed Hostinger deployment `4b679207a13b53dcaaf7df0dc22b46a2fa7c0290`.

## Actual remaining UI issue

`src/components/legacy-master-data-import.tsx` exposed its operative data-entry panel directly on the page: source kind, filename, complete UTF-8 CSV, validation preview and a create-record approval checkbox/button in the same page. The UI was out of alignment with the owner's compact centered action-form policy. Independently, `RevalidateImportButton` performed an audit-significant POST on its first click without an explicit confirmation and had no `try/catch/finally`; network interruption could leave the spinner permanently busy.

## Current scope

1. The legacy master import route now has a **Prepare CSV import** button opening a compact `CrudModal` for the source class, source filename and full CSV editor (up to 200 rows / 64 KiB as enforced by the existing server). Preview remains a readable inline table, not a mutation form. Cancel/discard clears unsaved CSV and any stale preview; successful preview closes the editor and keeps the reviewed source for the later fingerprint-bound apply.
2. A separate **Review and approve master import** button (only with a preview without conflicts) opens a compact modal with explicit data kind and new/total/conflict counts, plus the existing kind-specific clinical/financial constraints and consent checkbox. The submit is guarded by synchronous `inFlight`, consent, current preview and `expectedFingerprint` from the server preview. Successful/failed APPLY clears the review; a lost connection invalidates the preview, instructs the operator to check import status and blocks blind resubmission.
3. The staging batch **Revalidate Batch** action now opens a bilingual, focused compact confirmation dialog. The same previously existing POST is invoked only by submit. Network failures, unexpected responses and HTTP rejection block blind retry until page refresh and inspection. Response counts are checked as nonnegative safe integers before success is displayed; no optimistic success before a confirmed response.

## Server clinical / commercial invariants

All API routes and business logic are unchanged. Legacy master applies happen through the pre-existing Serializable transaction and compare `expectedFingerprint` after live tenant/branch and kind authorization. No existing code overwritten; no contract/price/balance created with client master import; clinical comment templates are created inactive and need separate review. Revalidation is only for author-owned, unprocessed legacy staging evidence, under live permission/department/branch-scope authorization, guarded CAS and an audit event. Neither action approves clinical intervals, changes signed results, or emits device orders.

**No schema migration, no new API, no database data modified by development.** These UI modals are not a replacement for backend authority. A screenshot or automation test is not clinical signoff.

## Verification and outstanding acceptance

`tests/ui-legacy-master-import-revalidation-modals.test.ts` tests both dialog paths, server fingerprint and scope invariants, network retry fencing, controlled spinner recovery, untouched clinical/commercial histories and the compact focus/RTL modal foundation. Full CI safety/TS/lint/MariaDB/build plus separate main CI must pass before Hostinger deploy acknowledgement.

**NOT_EXECUTED**: fully authenticated rendered UI, keyboard focus, mobile scroll/long CSV, live multi-branch roles, Arabic and English screenshots, complete 81-route comparison or owner signoff. **Issue #265 OPEN**. Qualified clinical/finance/device/Hostinger restore evidence gate stays **Issue #250 NO_GO**. The 88-section scope is unchanged.
