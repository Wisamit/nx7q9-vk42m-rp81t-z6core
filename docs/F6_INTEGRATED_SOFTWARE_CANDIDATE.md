# Family Lab — F6 integrated synthetic software candidate

## Purpose and exact sequence

F0/F1/F2/F3/F4 were implemented as prior source-level review/defect
closures. F5 code-side UX/modal and ambiguous clinical/financial response
guards were merged in PRs #339 and #340. F5 independent merged-main
[CI #2361](https://github.com/Wisamit/nx7q9-vk42m-rp81t-z6core/actions/runs/39760323574)
passed at baseline commit
`c4e3d9ef20699f376b95187b08aa7f504316f47c`.

F6 is the final **engineering-only synthetic release candidate**. The owner
explicitly deferred *all manual browser/visual interaction inspection* until
after code stages finish. **Do not execute or demand F7 owner/real-device UI
work while running F6.** F7 remains an independent later gate; F8 operational
GO/NO-GO is separate and cannot be automatically declared.

## New code-level evidence

1. `tests/f6-five-unmapped-scope-regressions.test.ts` directly tests the five
   previous Stage 131 matrix gaps (not automatically a proof of every
   underlying bullet):
   - §9 formula result safety — bounded interpretation of parser and clinical
     draft/approval route wiring;
   - §18 discount/manager authorization — exact tariff/tax/context fingerprint
     and branch/limit checks;
   - §29 referral/send-out safety — exact DECIMAL(18,4), site/custody row locks;
   - §72 global search — permission, tenant, branch, result-count and query
     bounds validated at source (not permissioned browser UAT);
   - §81 report template version governance — independent approved signatures,
     historical effective dates and prevention of unsafe backdating.
2. `scripts/f6-synthetic-software-gate.mjs` loads the **frozen F0 88-section
   triage**, the historical Stage 132 qualified UAT register and current
   repository sources. It refuses missing/mismatched numbered sections,
   mismatched qualified signatory category, missing source or regression
   anchor, absent core MariaDB integration file, or removal of mandatory CI
   suite lines. All 83 previously selected regressions plus five F6-added
   regressions must exist.
3. `tests/f6-software-evidence-gate.test.ts` injects removed/forged records,
   deleted test/source files and missing CI commands. Such errors must fail
   closed, not merely produce a warning.
4. CI now runs this F6 preflight and publishes JSON/Markdown evidence tied to
   the exact workflow `GITHUB_SHA`, distinct from the historical Stage 132
   pinned UAT release hash. It also continues all existing
   `npm run test:safety`, TypeScript, ESLint, MariaDB integration coverage,
   encrypted-backup/restore-guard unit tests, AR/EN code checks and Next build.
   Successful CI must be observed on the final feature SHA and independently
   after PR merge to current main.

## F6 acceptance meaning

- **Software gate passed** means: all 88 scope sections are traceable to
  existing source and a selected synthetic test anchor; the five previously
  missing references have their own concrete regressions; specified
  inter-module and transaction test suites ran in required exact-head CI
  without failed steps; a Next build succeeded.
- It does **not** imply 88 independent real-world workflow simulations. The
  Stage 130 synthetic multi-branch patient/order/invoice/payment/specimen/
  barcode/report test is an especially valuable cross-domain integration
  proof, while it still does not substitute for real lab hardware, clinical
  signatories, unit/range or finance policy acceptance.
- Software gate cannot certify actual Hostinger backup freshness, offsite
  encryption, restore time or recovery RPO/RTO. These are **F8 external
  operational checks**. No physical lab analyzer, original production MDB,
  patient data, government/finance statutory tax approval, vendor devices,
  medical approval, credentialed browser session or private evidence is
  introduced into repository tests.
- **F7: NOT_EXECUTED**, per owner sequencing. Its existing 81-route visual/
  keyboard/RTL/theme/timezone audits are postponed; CI may still perform
  non-interactive source/i18n checks as ordinary compile-time regressions.
- **F8: NO_GO** remains until all 88 qualified UAT cases and seven role-bound
  signoff gates actually pass. No previous `NOT_EXECUTED` value may be
  rewritten to `PASS` by a synthetic software gate.

## End-of-coding release pin

The GitHub source SHA after successful F6 merge will be the software release
candidate reference. A fresh Stage 132 private acceptance bundle should use
that SHA, **not** the previous historical UAT source SHA. Pinning and deployment
do not authorize GO; deploying to Hostinger requires owner-controlled backup,
confirmed installed build SHA and explicit stage scope. The `build` command
runs Prisma migrations, so never invoke it against a live database without
verified current backups and safe migration review.

Historic matrix and F0 triage remain immutable reference sources. F6
artifacts add current evidence but do not silently rewrite the master scope.
