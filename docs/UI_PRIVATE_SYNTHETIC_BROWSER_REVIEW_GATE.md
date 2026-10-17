# UI visual release gate: private-only synthetic staging evidence

## Owner deployment baseline and risk discovery

- Owner confirmed Hostinger deployed `main e4d05e75e7f3e78d482552e39bfd367cdbb5044b` (PR #287).
- The current GitHub repository `Wisamit/nx7q9-vk42m-rp81t-z6core` is **PUBLIC** (verified using GitHub repository metadata during this batch). Public GitHub Actions artifacts could expose screenshot content to readers. Therefore **never run or upload clinical/financial/staff screenshots from the current public CI**, even if an operator believes the fixture is synthetic.
- Existing `.github/workflows/ci.yml` had a dormant `browser_review` job pinned to one old branch `ui-unified-release-complete-sweep`, which never ran on newer UI batches. This is not evidence that the product was visually accepted.
- The earlier source-only `node scripts/ui-browser-evidence.mjs --validate` remains allowed in ordinary CI. It validates 81 canonical routes x 6 variants only; it does **not** visit a page.

## Consolidated changes

1. **Manual private review workflow**: `.github/workflows/ui-synthetic-browser-review.yml` is owner-initiated through `workflow_dispatch` on the exact **main** branch only. Runs exclusively when `github.event.repository.private == true`, repository variables explicitly opt in, and a protected `ui-synthetic-staging` GitHub Environment is configured. It uploads evidence for 2 days **in the private repository only**. No ordinary pull request or push can initiate this workflow.
2. **Protect legacy opt-in job**: add the same `github.event.repository.private == true` gate to the existing dormant `browser_review`. Do **not** remove legacy source gate or spoof a green browser-review state.
3. **Isolated preflight without Playwright**: `node scripts/ui-browser-evidence.mjs --preflight` validates source manifest, non-production HTTPS/loopback staging hostname, explicit synthetic attestation, exact dynamic route fixtures, explicit role/session data and all **486** route/scenario cases. It imports no browser and creates no screenshots.
4. **Fixture integrity**: each dynamic URL must match its original canonical path shape; `/reports/[orderId]` cannot be incorrectly represented by `/dashboard`. Browser session profile data must be inline Playwright `storageState` objects rather than a local path, with cookies and local storage strictly limited to the **exact** non-production staging host. No silent production-cookie reuse.
5. **Redirect integrity**: redirects off the staging origin are blocked before screenshot; all protected route redirects to login, portal login, or another unrelated page are marked `REVIEW_REQUIRED`. A screenshot of a login page is not falsely credited as worklist evidence; documented redirect-only routes still need human adjudication.
6. **Regression tests**: `tests/ui-private-synthetic-browser-workflow.test.ts` tests 486-case preflight, invalid route substitutions, off-origin cookies/localStorage, path-based storage state rejection, public workflow protection, and the existing no-click/no-fill/no-clinical-signoff contract.

## Prerequisites before FIRST real browser sweep

The following are genuine external dependencies **not yet set up or demonstrated**:

- **Private repository** (or use a local trusted workstation, keeping screenshots entirely local). If retaining the current public repo, the GitHub screenshot job intentionally stays SKIPPED.
- A separate non-production HTTPS Hostinger staging site with an explicit `stage`, `staging`, `qa`, `sandbox` or `test` label in its hostname; an isolated **synthetic** database, files, sessions, integrations, outbound email/SMS and never actual patients. No production DB replica containing clinical data.
- A qualified staff operator creates only synthetic patient/order/invoice/report/equipment fixture records and authorizes synthetic role/branch portal accounts. Each dynamic route in `docs/UI_ROUTE_MANIFEST.json` gets an exact synthetic URL mapping; no production IDs.
- Explicit reviewer confirmation that data are synthetic and that screenshot artifacts may be stored in a **private** repository. GitHub Environment `ui-synthetic-staging` should require authorized reviewers, with minimal secrets access and short-lived session cookies.
- GitHub repository Variables: `FL_UI_AUDIT_ENABLE=true`, `FL_UI_AUDIT_SYNTHETIC_ONLY=I_CONFIRM_SYNTHETIC_NONPRODUCTION_DATA`, `FL_UI_AUDIT_STAGING_ORIGIN=https://qa.example.test` (replace with your real non-production HTTPS hostname). Repository/Environment Secret: `FL_UI_AUDIT_CONFIG_JSON`. **Do not commit the secret, screenshot, session cookies, API keys or generated fixtures.**
- The `FL_UI_AUDIT_CONFIG_JSON` shape:
```json
{
  "syntheticDataConfirmed": true,
  "routePaths": {
    "/patients/[id]": "/patients/SYNTHETIC_PATIENT_ID",
    "/specimens/[id]/label": "/specimens/SYNTHETIC_SPECIMEN_ID/label"
  },
  "profiles": {
    "staff_ar": {"cookies": [], "origins": []},
    "staff_en": {"cookies": [], "origins": []},
    "portal_ar": {"cookies": [], "origins": []},
    "portal_en": {"cookies": [], "origins": []}
  }
}
```
  This is **illustrative only**: every dynamic route from the manifest must be included and each non-anonymous profile must carry valid, **synthetic-staging-domain-only** Playwright storage state; the empty arrays shown above do not sign in anyone. Do not include real credentials.
- For a **private local-only run** (possible even when GitHub is public), set environment variables locally, run `npm install --no-save playwright@1.56.1`, `npx playwright install chromium`, `node scripts/ui-browser-evidence.mjs --preflight`, then `node scripts/ui-browser-evidence.mjs --run`. Store `FL_UI_AUDIT_OUTPUT_DIR` outside public working trees; never commit or upload screenshots.

## Interpretation / NO-GO conditions

- A successful `--preflight` means only that **planned browser cases and synthetic scope validate**. No screenshot or clinical sign-off has occurred.
- A successful browser run produces 486 images only if all navigation and captures actually succeed; any runtime, input-label, clipped action, unauthorized redirect, RTL/LTR or horizontal-overflow issue triggers `REVIEW_REQUIRED` and nonzero exit. Captures alone never equal signed visual acceptance.
- Automated route capture does **not** test clinical decisions, financial ledgers, integrations, printer hardware, accessibility keyboard activation of every modal, approved role access in every branch, backup/restore or data protection.
- Issue **#265 stays OPEN** for real browser review of 81 routes, actual AR/EN RTL/LTR/theme/mobile/desktop visual inspection and corrections; issue **#250 stays OPEN / clinical & financial NO_GO** pending qualified acceptance.
- No schema migration, application API change, clinical history rewrite, price/range/tax recalculation or release workflow mutation is included in this QA infrastructure batch.
