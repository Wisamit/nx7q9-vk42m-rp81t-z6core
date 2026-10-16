# Issue #265 — Operational configuration dialogs and route inventory

## Source checkpoint

- Base main: `5434d8af05d7f687e2f7ceba856429395ae1e46d`
  (PR #272); owner confirmed Hostinger deployment.
- No scope removal; Master Scope §§75/86/87/88 and #250 remain independent
  release gates. Qualified 88-case physical UAT remains NOT_EXECUTED/NO_GO.

## Actual UI changes in this package

1. `/settings/specimens`: mutation-heavy inline rejection-reason create/edit
   forms become a labeled **Add** trigger and per-record **Edit** trigger.
   The same bilingual inputs are inside the compact, internally scrollable
   guarded dialog. Existing codes remain immutable; failure retains fields
   and surfaces the API error in place. Audit/history still belong to the
   unchanged server endpoint.
2. `/patients/identifier-schemes`: custom scheme creation is no longer
   an inline form. The high-impact deactivation replaces the native
   `prompt()` with a separately labeled confirmation dialog that requires
   a written reason. The same server-side restriction on standard schemes
   and audit reason is preserved; existing patient identifiers are not edited.
3. `/billing/taxes`: a publish button now explicitly opens a compact form.
   Existing branch/organization scope, selectable service, entered rate,
   treatment, date, publication reason, server permissions, exact decimal
   validation and immutable revision history remain unchanged. This UI
   change **does not** invent tax rates or activate policies.
4. Shared compact-dialog CSS now forces one-column operational forms to
   prevent horizontal clipping. Active submissions cannot be dismissed by
   close/Escape/backdrop callbacks in these three managers.

## Entire-route discovery and drift control

- `docs/UI_ROUTE_MANIFEST.json` enumerates **all 81 exact source page paths**
  and derived routes at the inspected baseline. It includes dynamic,
  public/auth, portal, clinical, billing and print-oriented paths.
- `scripts/ui-route-form-inventory.mjs` uses TypeScript AST to scan every
  page and its directly imported UI components, report form and modal counts,
  and identify **potential** inline mutation forms with file and source line.
  It explicitly labels all actual browser, mobile, AR/EN and role/branch
  review cases `NOT_EXECUTED`; heuristic candidates are not proven defects.
- The existing CI must verify source paths against the committed manifest
  (adding, deleting, renaming a route requires deliberate manifest update)
  and attach `ui-route-form-inventory.md` as an Actions artifact for triage.
- An import nested further than one component, client-side dynamic view,
  action not represented by a `<form>`, or protected role route might be
  absent from static counts. The report **cannot** replace real screenshots,
  keyboard/focus, mobile, localization, theme/timezone and permission tests.

## Still OPEN — do not declare full UI acceptance

Every route and role/branch experience needs a real interactive browser
walkthrough and screenshot evidence. Remaining inline operational forms,
noncompact legacy dialogs, settings-driven date/time issues, public/portal
contexts and domain-specific clinical workflow exceptions must be triaged
and corrected. Clinical/financial signoff, source MDB parity, real analyzers
and restore rehearsals remain governed under issue #250.

No patient data, financial history, device commands, price/range values or
report releases are modified by this package.
