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

### Additional work completed on this still-unmerged release branch

- EQA: nine audited program, external sample measurement, submission,
  independent assessment, finalization, closure and retirement actions
  now have explicit modal controls. Reviewer/submitter separation and
  synthetic/nonpatient status remain unchanged at the server layer.
- Quality-management lifecycle: eleven previous native `prompt` /
  `confirm` workflows for CAPA effectiveness/action, nonconformance
  closure, controlled document workflow/version, analyzer authorization,
  quality indicator measurement and audit finding/closure/completion now
  have explicitly typed bilingual review forms. Critical audit findings
  must select an existing open CAPA; a free-text CAPA identifier is no
  longer silently accepted. Evidence and version history remain server
  authoritative; UI tests guard these decisions.
- Central patient identifier management: a separate compact create
  dialog and reason-required deactivation review replacing native
  browser prompting. Full patient-history/audit controls remain intact.
- Test catalog and clinical catalog: replace hand-built
  `modal-backdrop` overlays with shared compact dialogs for test/master
  data, components, panels/profiles, TAT drafts and reference-interval
  drafts. Clinic-sensitive `effectiveFrom` no longer silently chooses
  today's **UTC** date: a qualified user explicitly enters the intended
  effective date for new TAT/range drafts.
- Commercial packages: member-test choice survives failed submissions;
  the package is still a financial grouping and not one merged clinical
  result. One-third dialog width is scrollable on small screens.
- Payment methods: create and auditable activation/deactivation now have
  separate compact dialogs; no prompt and no mutation of historical
  payment/refund snapshots.
- Report templates: creation/version drafts and independently reviewed
  approval/activation use guarded dialogs. Existing 12-character review
  explanation, exact version confirmation, independent reviewer checks
  and immutable prior report snapshots are preserved. Network errors
  retain form fields.
- Inventory interbranch stock transfers: create, approve/reserve,
  dispatch, partial receive and finalize receive now use two guarded
  modal workflows; the exact selected lot quantities are snapshotted
  for review. Transfer custody/branch checks and discrepancy accounting
  remain server enforced; network failure never pretends a stock
  transaction succeeded.

### Additional UI protection on this same UNMERGED branch

- Analyzer worklist routing: mapped instrument assignment and audited
  removal now use separate compact modal reviews. Removing a route requires
  a documented reason and does not delete prior analyzer observations.
- Analyzer message replay: explicit modal to queue a single immutable raw
  message again; this neither verifies nor releases a clinical result.
- Analyzer clinical import: a separate confirmation dialog lists the number
  of selected mapped observations; import only targets a result draft and
  never substitutes for independent clinical validation.
- Recall escalation: open a branch-scoped quality nonconformance only after
  a deliberate confirmation; existing recall holds and patient/report
  history remain unchanged.
- Organization-wide lot quarantine, irreversible recall and independently
  reviewed release now have a guarded one-third-width review, preserving
  the original server-side lot/branch permissions and transactional audit.
- Branch-specific inventory safety response now uses an explicit modal;
  physical stock isolation remains an operator attestation, NOT proof of
  physical stock verification or patient exposure.
- Staff password reset keeps existing secure modal and administrator
  re-authentication, but no longer stacks an additional native browser
  confirm dialog; session revocation and MFA preservation are explained.
- Clinical result comment revisions now open a compact edit dialog,
  preserving the source version and fingerprint. A different authorized
  reviewer must later approve the INACTIVE successor and supersede the
  predecessor transactionally.
- Order-level clinical handover annotation now offers compact creation,
  correction, acknowledgment and reasoned retraction dialogs; corrections
  keep stable idempotency keys until success, preserve every historical
  note and cannot edit released results or invoices.
- Domain-specific regression tests have been added for these workflows.
  All claims above are code and CI scope, **not** live browser evidence.

### Still unresolved — not a screen-completion claim

- Source audit and CI do **not** establish actual rendered screen layout,
  screenshot comparison, keyboard navigation, user role permissions,
  responsive behavior, RTL date formatting or owner acceptance.
- The remaining 81-route inventory includes clinical results, billing
  invoice/refund workflows, specimen custody, analyzer controls,
  microbiology and special report/print interfaces. Every inline-form
  candidate must be classified by use case, and safety-specific layouts
  must be reviewed rather than mechanically put into small dialogs.
- External analyzer, real MDR/MDB data and Stage132 UAT are independent
  clinical-governance gates (#250). No GO is implied by green CI.

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
