# F7 — Finite source-level closure triage (2026-10-23)

**Baseline:** main 577c1c4650d7f6d21dadf5b072d9efec401f2ad6, merged PR #374, independent push CI #39969551343 SUCCESS. This is an engineering source-review record, **not** evidence of a completed browser/owner test.

## One bounded review instead of another portal micro-PR cycle

Scope inputs: the versioned 81-route docs/UI_ROUTE_MANIFEST.json, the AST route/form inventory in scripts/ui-route-form-inventory.mjs, the earlier 15 possible inline-form leads, docs/UI_LARGE_MODAL_GOVERNANCE_PACKAGE.md, existing F7 login/OTP/booking/clinical disclosure regressions and issue #265. The inventory detects direct imports only; its possible-form count is a triage heuristic rather than 15 verified defects. We did not run a private browser or touch production patient data.

| Target / possible gap | Evidence and boundary | Disposition |
| --- | --- | --- |
| Patient/portal login, original principal, tenant and OTP revocation | Merged #358–#374 and focused MariaDB/conditional-claim tests; duplicate login and issue/verify races already addressed | No new source defect established in this bounded pass. Do not reopen a one-line PR without a reproducible regression. |
| Portal booking and home collection | Merged #352/#354/#355/#357/#358; unique-backed booking and minimal receipts; multi-connection database gate | No new source defect established; real timezone/branch UX deferred. |
| Protected clinical report/invoice disclosures | Merged #355/#356/#359/#360 and clinical read/link restrictions; owner and branch views still require rendered walkthrough | No new source defect established; UAT required. |
| Compact centered forms / modal governance | Existing CrudModal, keyboard/dirty/focus source gates, themed responsive CSS and earlier large-domain modal repairs; 81 route manifest with 15 earlier possible inline leads | No claim of zero remaining defects: require the private rendered 81×6 inventory, visual/keyboard audits and owner-approved exceptions. |
| Bilingual, RTL/LTR, branch theme and timezone | Existing CI i18n, theme/date source gates; no isolated private browser captures taken here | NOT_EXECUTED for owner browser/real role/branch experience. |
| Catalog/review, specimen transfer, result release and billing workflows | Existing MariaDB transaction, snapshot, permission and audit suites remain in CI. This PR addresses confirmed §87 draft tariff review safety, not a live clinical release change | F8 configuration input finding tracked separately; actual medical and financial policy signoff BLOCKED_EXTERNAL. |

**Finite software-triage result:** no new confirmed high-severity F7 source defect was established by this targeted review. This does NOT justify a blanket assertion that all 81 routes and all nested components are defect-free. No additional speculative portal PRs are created. The remaining real F7 closure gate is the one consolidated private acceptance campaign, deferred until software coding is complete.

**Status:** F7_SOURCE_TRIAGE_FINISHED, F7_OWNER_BROWSER_UAT_DEFERRED, F7_BROWSER_EXECUTED=0/486; issue #265 remains OPEN. A subsequent proven regression may still require a fix; do not label F7 visually approved or operationally ready.
