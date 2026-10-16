# Family Lab — unified UI release candidate (single hosted deployment gate)

**Status:** WORK IN PROGRESS / NOT READY TO DEPLOY.

Owner confirmed `3c59cec87d26de23599bf29c1ac47084450f7de2`
was deployed on Hostinger. This branch starts from precisely that commit.
The owner explicitly asked us to **stop sending individual UI-stage deployments**.
All UI fixes belong in one cohesive release branch, reviewed and verified
together, before a single final Hostinger deployment. Working PRs may run
CI, but **must not be merged/released as a claimed complete UI** prematurely.

## In-scope inventory

`docs/UI_ROUTE_MANIFEST.json` pins the **81 known Next.js page routes**,
including dynamic patient/order/report, billing, catalogue, operations,
identity, access, doctor/patient portals, print/label, public verification,
and organization operations. The branch also inventories **all TSX
components** and tracks recursive component imports, modal and form
candidates, native browser confirmation, and date/time formatting callsites.

Run:
- `node scripts/ui-full-surface-audit.mjs --check`
- `node scripts/ui-full-surface-audit.mjs --markdown`
- `node scripts/ui-full-surface-audit.mjs --json`

The generated Markdown and JSON are automatically uploaded by CI as
`ui-full-surface-audit`. This prevents **forgotten source routes**, but
a static source scan is *not* a rendered UI/interaction test. The report
keeps 81 per-route evidence states for actual browser screenshots,
viewport checks, AR/EN RTL/LTR, organization palettes, local-time
preferences, branch RBAC and keyboard/screen reader use as `NOT_EXECUTED`.

## Already included in this one release branch

- Organization branches, departments and workstations: move all three
  create/view/edit forms and governed status confirmation into compact
  bilingual dialogs; preserve immutable codes, branch scoping and local
  working-hours action on existing endpoints.
- Critical-results escalation: a create-draft dialog, with API error
  retention and explicit no-clinical-activation until approval.
- Result validation policy: a create-draft dialog, preserves governing
  data, client payload and separate clinical approval.
- Qualitative result meanings: create-draft dialog and review dialogs
  for `APPROVE` / `RETIRE`. Replace native confirm/prompt; retirement
  needs a written reason. Preserve API authorization, historical snapshots,
  approval/retirement state and audit.
- Shared compact layout: force admin/detail/forms to a safe single column
  inside the one-third-width desktop dialog; protect focus-visible,
  wrap long values, and respect mobile dynamic viewport and safe-area.
- Additional compact dialog conversions: supplier/category/item and lot
  receiving, stock adjustments and consumption, equipment registration/
  maintenance/calibration/downtime/document, client credit policies,
  integration endpoint/mapping/external API key/webhook, corporate/portal
  patient access, appointments and queue issuing, doctor-patient access
  grants and reasoned revocation, finance discount approval/rejection with
  mandatory staff step-up, clinical requisition decline, QC material/lot/
  target/run, procurement request/order, controlled quality documents/
  CAPA/training/audits, notification templates, send-out laboratory/referral
  and specimen retention/disposal request authorship.
- Secrets from integration API key issuance are visible only while the
  relevant dialog remains open, cleared when closed, and not in the
  underlying page. Existing authorization still stays server-side.
- Dedicated CI regression for changed workflows, all 81 source pages,
  nested component coverage and honest real-browser evidence status.

### Unresolved action-level UI debt
- Quality management contains many native high-impact workflows (closure,
  CAPA review/action, audit findings, document approval, analyzer
  authorization). They must be redesigned as reasoned validated dialogs
  **without weakening** the existing clinical/quality authorization.
- EQA has 9 source forms including assessment/finalization that are not
  ordinary CRUD; preserve reviewer separation and protected escalation.
- Historical specialty result entry, clinical report print, specimen custody,
  invoice refund/reversal, doctor portal, password step-up and other
  noncompact dialogs need intentional viewport/role/keyboard assessment.
- The source audit exposes every candidate; these remain NOT_ACCEPTED until
  actual interactive browser evidence is produced.

## Must happen **before** one final deployment

1. Triage each distinct source candidate in the comprehensive inventory:
   classify as mutation, search/filter, read-only view, or high-risk
   clinical/print/auth exception. No silent exceptions from the one-third
   modal policy.
2. Convert remaining confirmed inline CRUD/action editors into consistent
   compact dialogs. The clinically complex and emergency workflows must
   be reviewed for safe behavior before altering layouts.
3. Audit noncompact legacy dialogs; keyboard/focus/dirty close;
   loading/error/empty states; bilingual text and true RTL/LTR;
   dark/light/system theme with organization colors; date/time/timezone
   through the correct organization formatting and input semantics.
4. Execute browser screenshots and interaction checks for **all 81 routes**,
   plus responsive and role/branch combinations, using **synthetic**
   fixtures and appropriately permissioned nonproduction test accounts.
   Dynamic routes require test fixture IDs, not invented production IDs.
   Capture results and failures in review evidence. Source-only CI cannot
   produce this evidence or mark it complete.
5. Run full feature CI, Next build, MariaDB integrations and safety
   checks. Resolve failures. Merge one pinned release candidate and
   verify an **independent main CI** on the merge SHA.
6. Only after all software/UI gates pass, schedule **one** Hostinger
   deployment of that verified SHA and verify actual hosted UI against
   the candidate; obtain owner visual acceptance. GitHub merge/CI never
   counts as actual hosting deployment.

## Separate clinical release gate

Issue #250 stays OPEN: Master Scope §§75/86/87/88, private real MDB
reconciliation, vendor-specific analyzer/QC safety, accountant-approved
tax/currency details, and qualified 88-case live-workflow UAT and
clinical/finance/device/privacy/DR/owner signoffs still require
independent evidence. The current GO/NO-GO is **NO_GO**, regardless of
visual progress. Issue #265 stays OPEN until all UI evidence and owner
signoff are present.

No feature in `02_MASTER_SCOPE.md` is removed to save time.
