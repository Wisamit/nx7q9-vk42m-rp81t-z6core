# Family Lab — actual browser/screenshot acceptance gate for issue #265

**Status: NOT_EXECUTED / NOT_SIGNED_OFF.** The existence of a browser test
runner and a green source CI does **not** mean an 81-route visual review
has occurred. Do not mark a screen passed based on a source audit or login
redirect. This is one part of the single unified UI release candidate
requested by the owner; do **not** deploy partial UI features to Hostinger.

## Coverage target

The authoritative route manifest `docs/UI_ROUTE_MANIFEST.json` contains
exactly **81** page routes, including **17 dynamic parameterized routes**.
The source component inventory currently includes **135 TSX components**.
No listed page or imported clinical/financial/microbiology component may
be silently omitted. Protected portal routes and public/auth pages must
be reviewed separately.

The manual opt-in browser workflow is
`.github/workflows/ui-browser-sweep.yml`. The executable implementation
is `scripts/ui-browser-acceptance.mjs`. Ordinary PR CI executes
`node scripts/ui-browser-acceptance.mjs --plan` in regression tests but
**never** automatically captures authenticated screenshots. A separate
human-started `workflow_dispatch` requires an explicit synthetic-data
attestation and securely provisioned staging secrets.

## Staging-only prerequisites

1. A completely **isolated** staging deployment, running the same candidate
   Git SHA and populated with synthetic patient identities, specimen
   barcodes, paid/unpaid test orders, released/amended reports, API records,
   authorized branch transfers, analyzer/QC examples, inventory, EQA,
   microbiology cases, and appropriate role assignments.
2. A staging host named with `staging`, `qa`, `test`, `synthetic`, or
   `preview`, using HTTPS (or localhost via HTTP). The runner refuses
   production-like domains by design and will not upload real PHI.
3. Two or more synthetic staff users with different declared `role`
   and `branch`, and a synthetic portal account. MFA cannot be bypassed;
   it must be satisfied legitimately or a suitable separately governed
   QA-only profile provisioned.
4. **All 17** parameterized paths populated with actual synthetic test
   identifiers. Canonical patterns are JSON keys and resolved synthetic
   route paths are values (e.g. `"/patients/[id]":
   "/patients/SYNTHETIC_PATIENT_ID"`). Never use real report tokens,
   identifiers, patient records or real company credentials.

## Required GitHub Actions secrets

- `UI_QA_STAGING_BASE_URL`: isolated synthetic staging HTTPS origin.
- `UI_QA_STAFF_PROFILES_JSON`: an array of at least two objects
  with `username`, `password`, `role`, and `branch`. Roles and
  branches must actually differ. Do not print or commit this JSON.
- `UI_QA_PORTAL_PROFILE_JSON`: object with `organizationCode`,
  `login`, and `password` for a synthetic portal account.
- `UI_QA_FIXTURE_ROUTES_JSON`: object keyed by each canonical dynamic
  route pattern to a valid synthetic route path. The preflight aborts
  if any dynamic route is unresolved.

The runner captures **desktop EN/light, desktop AR/dark, mobile EN/light,
and mobile AR/dark** variants per assigned route, recording horizontal
overflow, redirects, HTTP errors, missing language direction and
screenshots. Role-specific protected views are not marked passed when
they redirect to login. It records `CAPTURED_UNREVIEWED`, not `PASS`.
If an authorized restricted account does not have access, the case needs
a documented expected-denial role matrix before it can be signed off.

Public/portal language variants require actual organization/account
localization setup; the runner deliberately reports them blocked when
the displayed direction does not match the requested locale. A screenshot
with an English page must **not** masquerade as Arabic coverage.

## What the browser runner deliberately does not automate

- Real create/edit/delete submission, payment posting, clinical result
  approval/release, QC decisions, data import activation, patient merge,
  analyzer commands, or irreversible specimen/inventory movements.
- Full keyboard/screen-reader accessibility, human review of every
  modal, long form and translation, and clinical or finance signoff.
- Branch/department RBAC acceptance of 100% of roles (two staff role
  fixtures are a starting minimum, not a complete permissions matrix).
- Alternate tablet width, printing on installed printer/label equipment,
  verified report layouts against real analyzer/MDB standards.
- Qualified Stage132 **88-case** clinical, finance, analyzer, DR and owner
  UAT. The release remains `NO_GO` until each gate is separately signed.

Human reviewers must use the resulting `ui-browser-sweep-evidence` Actions
artifact and the source audit to perform and record these additional cases,
and fix any failures in the same unified release branch before merging.

## Single final deployment rule

The UI PR stays **Draft**. Once all 81 routes have documented browser,
screenshots, AR/EN RTL/LTR, responsive, settings-driven appearance/time,
keyboard, branch/role and CRUD/action review, run full feature CI and
independent main CI on a pinned final SHA. Then and only then request a
**single** Hostinger deployment of that SHA. GitHub green does not mean
deployed, and deployed does not mean approved for clinical use. Issues
#265 and #250 must stay open until their independent evidence is complete.
