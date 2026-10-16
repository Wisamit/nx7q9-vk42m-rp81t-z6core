# Family Lab — accelerated software/UI closure tracker

This is an execution checkpoint for issue #265 and the related software portion
of #250, **not** permission to remove any of the 88 master-scope sections.
It is not a production GO/NO-GO or a promise of a fixed calendar completion.

## Current verified baseline (after Stage 145)

- Main commit: `7093d927a5b260c7323b25263a5246ba4d289813`.
- Repository inventory: 81 `src/app/**/page.tsx` routes, 134 `src/components/*.tsx`
  components at the initial checkpoint.
- Existing CI covers TypeScript, ESLint, safety, MariaDB integrations,
  theme/i18n static guards and Next production build.
- **No complete per-screen browser/visual audit is evidenced.** Automated
  static assertions cannot stand in for role-, branch- and device-specific
  browser interaction evidence.
- #250: §75 analyzer interference, §86 jurisdictional tax/currency rules,
  §87 configuration round-trip and governed approval, §88 real MDB-row parity
  and signed clinical/finance/hosted UAT remain release dependencies.
- Stage132 real-world 88-case UAT is NOT_EXECUTED and final status is NO_GO
  until qualified evidence is signed.

## First UI correction package (this change)

1. Convert the system-settings route from directly visible editing into a
   read-only settings summary with an explicit compact editor action.
2. Use a ~one-third-desktop-width responsive dialog for the editor. Keep
   settings controls single-column and scroll inside a bounded dialog.
3. Make the shared CRUD dialog accessible with unique heading/description
   IDs, topmost-dialog keyboard Escape/Tab handling, trigger-focus return,
   body scroll restore and a localized warning before discarding edited
   fields. The existing server-side settings API remains unchanged.
4. Add CI safety checks for these decisions. Do not label this package a
   complete UI audit: other routes and specialty result workflows are pending
   individual review, plus actual interactive screenshots and owner signoff.

## Closure method (no more arbitrary stages)

- Produce an actual route/form/modal inventory, including authenticated,
  public, portal, print, and emergency clinical workflows.
- Resolve inline operational mutations and visual/a11y violations in
  domain-coherent change sets, with focused tests on each modified workflow.
- Test Arabic/English, RTL/LTR, light/dark/system themes, organization date
  and timezone settings, desktop/tablet/mobile, keyboard/focus, closing dirty
  dialogs, permissions and multiple branches. Capture real browser evidence
  rather than claiming success from static greps.
- Reconcile remaining §75/§86/§87/§88 blockers without introducing invented
  analyzer commands, tax rules, ranges, prices or historical rewrites.
- Freeze a signed release-candidate SHA, run complete CI and all UI cases,
  then invite the laboratory owner to evaluate with synthetic data.
  Real patient/device/financial UAT and final GO still require their
  separate qualified signoffs.

**Status:** accelerated work in progress. #265 and #250 remain OPEN.
