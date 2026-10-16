# Family Lab — All-route browser evidence (synthetic staging ONLY)

**Status:** Harness implemented, real browser run **NOT_EXECUTED**.
**Release gate:** #265 stays OPEN. The current draft PR #275 is not
merged and must not be deployed just because source checks pass.

The owner requested **one complete UI release and one Hostinger deployment**.
Automated source review and GitHub CI do not prove that all UI layouts, create/
edit forms, bilingual RTL/LTR, organization palettes, dates or branch access
were visually examined.

## Protected baseline

- Exactly **81 canonical Next.js pages** in `docs/UI_ROUTE_MANIFEST.json`.
- **Six browser scenarios per route** (486 total screenshots expected):
  desktop Arabic/light; desktop English/dark; mobile Arabic/dark; mobile
  English/light; tablet Arabic/light; tablet English/dark.
- Each scenario navigates with **GET only**; it does not click buttons
  that could order tests, edit patients, release results, publish pricing
  or transfer/dispose clinical specimens.
- Dynamic pages require an explicit **synthetic** fixture mapping to
  their route, never an inferred production patient/order/report ID.
- Output includes a screenshot and HTTP/redirect/HTML lang/dir/viewport
  overflow/JavaScript-error flags, without storing URLs with IDs,
  page text, cookies, passwords or raw exception messages.
- Every screenshot remains **UNREVIEWED** until an authorized person checks
  it; keyboard/form mutation, organization date/time formatting, branch/role
  isolation, accessibility, visual theme palette and clinical UAT require
  separate **manual/interactable** evidence.

## Manual preparation: dedicated non-production Hostinger staging

Create an isolated staging installation with its own MariaDB database and
**synthetic patients, orders, catalog, specimen barcodes and reports only**.
Never point this harness at live Hostinger production, real patient data,
production sessions, clinical analyzer hardware or finance records.

The release branch supplies:

`node scripts/ui-browser-evidence.mjs --validate`

This safe source-only command is executed as part of normal CI. It does not
open a browser or contact hosting.

Actual Playwright review is opt-in. Set these repository **Actions Variables**
only after synthetic staging is ready:

- `FL_UI_AUDIT_STAGING_ORIGIN`: HTTPS origin on an explicit staging/qa/
  sandbox/test host, no path/query/credential.
- `FL_UI_AUDIT_ENABLE`: `true`
- `FL_UI_AUDIT_SYNTHETIC_ONLY`:
  `I_CONFIRM_SYNTHETIC_NONPRODUCTION_DATA`

Set **GitHub Actions Secret** `FL_UI_AUDIT_CONFIG_JSON`. The JSON schema is:

```json
{
  "syntheticDataConfirmed": true,
  "routePaths": {
    "/patients/[id]": "/patients/SYNTHETIC_PATIENT_ID",
    "/orders/[id]": "/orders/SYNTHETIC_ORDER_ID"
  },
  "profiles": {
    "staff_ar": {"cookies": [], "origins": []},
    "staff_en": {"cookies": [], "origins": []},
    "portal_ar": {"cookies": [], "origins": []},
    "portal_en": {"cookies": [], "origins": []}
  },
  "routeProfiles": {
    "/special-restricted-route": {"ar": "staff_ar", "en": "staff_en"}
  }
}
```

This is a **shape example only**. The empty session states **do not
authenticate**. The `routePaths` object must include ALL actual dynamic
routes found in the manifest, and the corresponding synthetic fixture
identifiers must exist in staging. Authenticated browser states must be
generated with **staging-only role accounts** and stored solely in the
encrypted secret. Use independent Arabic/English user preferences as
needed, plus patient-portal accounts and branch-scoped staff fixtures.
Never commit any state cookies, MFA secrets or fixtures containing real PHI.

When the PR is ready for actual visual acceptance, add label
`ui-visual-ready` to **PR #275**. The existing CI workflow then runs an
independent `browser_review` job **only** on the internal unified UI
branch, with all three variables and the encrypted secret present. It
installs Chromium, runs `node scripts/ui-browser-evidence.mjs --run`,
and uploads `ui-browser-evidence-synthetic-only` with **7-day retention**.

The visual job is deliberately not triggered by default on every code push:
its absence or skipped status is **NOT a passed browser test**. No source
scan or automated screenshot may mark a manual UAT case PASS.

## Acceptance before ONE final Hostinger deployment

1. Verify all 81 routes and all generated screenshot captures, resolve
   any missing route/redirect/HTTP/runtime/overflow findings. A screenshot
   itself is not visual signoff.
2. On real browsers, interact with each CRUD view **using synthetic test
   data**: create/edit/status/retry/unsaved close/focus/keyboard/mobile
   plus AR/EN RTL/LTR, organization palette and precise date/time/timezone.
3. Exercise multiple organization, branch and role scopes. Confirm
   unauthorised views fail closed; patient IDs and financial/clinical
   history stay isolated.
4. Record each clinically complex exception to compact modal sizing,
   especially microbiology AST multi-antibiotic editing, emergency result
   release, transfer chain-of-custody and dynamic report/print rendering.
   Do not silently reduce high-risk inputs to a small modal.
5. Obtain owner UI acceptance, pin final PR SHA, verify full feature CI
   and browser evidence, merge **once**, then verify independent main CI.
   The owner confirms ONE deployment to Hostinger of the exact merged SHA.
6. Real analyzer/QC, external clinic integration, finance rules, original
   MDB ACE parity, DR restore rehearsal and 88 signed Stage132 UAT cases
   remain **NO_GO** release gates under #250, independently of the UI.

**Nothing here authorizes production data access, destructive actions,
implicit clinical threshold changes or silent history rewrites.**
