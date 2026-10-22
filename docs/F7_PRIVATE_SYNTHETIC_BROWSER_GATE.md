# F7 — private synthetic browser acceptance gate (in progress)

## Exact software baseline

F0–F6 engineering completed on `main` commit
`1f26ec25f55422cce1ef1ac24e66ae47fcbaecac`.
Independent main [CI #2373](https://github.com/Wisamit/nx7q9-vk42m-rp81t-z6core/actions/runs/39766112990)
completed successfully, 210/210 validation steps. This is **not** visual
acceptance.

The source inventory fixes for F5 cover all **81** canonical routes and
report **0 static source modal-policy violations**. They do not establish
real rendered fidelity, successful authentication or keyboard interaction.
F7 is **IN_PROGRESS**, not PASS. Full Master Scope §1–88 remains in force.

## Critical environment gate

The connected GitHub repository was checked and is currently **PUBLIC**.
Screenshots of even purportedly synthetic LIS sessions may expose patient
values or confidential branding, credentials, cookies, and private route IDs.
Do **not** publish screenshot artifacts or authenticate with real data in
public GitHub Actions.

The legacy `ui-browser-sweep.yml` manually dispatched workflow previously
lacked the repository-private condition. Both browser screenshot workflows
now require all of the following before *any* browser work:

- GitHub repository `private == true`, exact `main` branch;
- an explicitly approved `ui-synthetic-staging` GitHub environment,
  protected by project-controlled access;
- the documented synthetic-only attestation and feature enablement;
- an isolated HTTPS staging/test/QA hostname, **not live/prod**;
- 81 dynamic-route synthetic fixtures and separate non-production staff and
  patient-portal session contexts, with no PHI or real original MDB data.

A public repository is **BLOCKED FOR AUTOMATED SCREENSHOT ARTIFACT UPLOAD**.
Do not remove or weaken this gate to make a green check.

## Full browser capture plan (not yet executed)

Existing `ui-browser-evidence.mjs` independently probes 81 routes across
6 combinations of Arabic/English, RTL/LTR, desktop/tablet/mobile and
light/dark browser schemes (**486 non-mutating captures**), using private
synthetic sessions. The collector records anonymous categories for HTML
locale/direction, successful source route (not login redirect), HTTP status,
runtime errors, overflow, viewport clipping, accessible input/action labels,
and visible modal name/aria-modal semantics. It deliberately never clicks
data-changing controls or reads form values into JSON.

Added `scripts/f7-browser-evidence-integrity.mjs` enforces:

1. Exact 81-route manifest, all six scenarios per route, **486 unique cases**;
2. screenshot filenames confined to the local private evidence directory,
   non-symlink readable PNG signature and nonempty file;
3. no missing, redirected or error captures are treated as complete;
4. no automatic or forged owner/medical/branch-role/theme/timezone/modal
   interaction signatures;
5. a **capture-complete-but-not-visually-approved** outcome only after
   all checks, never a clinical GO.

Synthetic regression tests inject missing routes, duplicate cases, unsafe
filenames, fake approver PASS and damaged screenshots. The integrity check
is executed in the **private** browser-review workflow after capture and its
summary has counts/category codes, not patient or page content.

## F7 evidence cross-check hardening (next software increment)

The integrity validator now independently checks every claimed successful case's
HTTP 2xx response, login-redirect flag, Arabic/English document language and
RTL/LTR direction against the declared scenario, absence of horizontal overflow,
runtime errors, clipped controls, unlabeled inputs/actions, and dialog accessibility
findings. The capture runner explicitly selects the cosmetic light/dark preference
in isolated staging, then verifies the effective rendered `html[data-theme]`
against the scenario; persisted profile theme overrides cannot silently produce
mislabeled screenshot evidence. This does **not** prove either organization's
configured brand palette or accessible contrast without private rendered review. A forged `SCREENSHOT_CAPTURED` status with contradictory captured
metrics fails closed as `F7_CAPTURE_METADATA_INVALID`, even when its `issues`
array was cleared. Negative tests cover missing metrics and false-green statuses.

The browser collector now splits multi-ID `aria-labelledby` values on actual
whitespace, avoiding a false inaccessible-dialog finding for valid ID references.
These are **source/contract regression fixes only**, not browser execution,
visual acceptance, modal-interaction signoff or production readiness.

## F7 screenshot artifact integrity extension (automated only)

Each captured scenario now stores a SHA-256 digest of its actual private PNG
bytes in `evidenceSha256`. The integrity gate re-reads the file, verifies the
standard PNG signature and IHDR header, and compares the content hash with the
capture record. It also confirms that the PNG width equals the expected
Playwright viewport (desktop 1440, mobile 390 or tablet 820 pixels) and its
height is at least the corresponding viewport. An old/replaced, truncated,
wrong-viewport or mismatched screenshot cannot count as a verified capture.
The integrity summary counts only **actually validated** files, not simply
filenames present on disk. This is useful in private synthetic staging and
still does **not** establish that a screen was visually reviewed or clinically
approved.

**Product-owner sequence decision (2026-10-22):** Do not request manual
browser/visual/device/Hostinger/clinical/financial reviews while remaining
engineering phases are being completed. Continue software fixes and automated
CI testing. Keep F7 visual and interaction signoff `UAT_DEFERRED / NOT_EXECUTED`,
and qualified F8 operational release `NO_GO`, for a consolidated
owner-operated end-of-project review. Never interpret this deferral as a
waiver of any requirement in Master Scope §§1–88.

## Subsequent F7 acceptance (still outstanding)

Screenshot capture is a first step. To complete F7, authenticated
reviewers must still inspect every route and, in a protected environment,
perform **safe synthetic interactive** tests of visible create/edit/view
dialogs, close/reopen, keyboard focus, dirty changes and Escape; role/branch
permissions, patient/order/specimen/financial messages, mobile/tablet and
screen-reader use, both custom organization palettes, organization timezones
and date formats, and representative DST boundaries. Explicitly classify the
15 possible inline-form sources and 256 date/time formatting callsites
instead of declaring those numbers failures or exemptions without rendered
evidence.

Any medically or financially sensitive mutation in F7 must use fully
synthetic fixtures and preserve the ordinary server permissions, audit and
rollback behavior. Browser capture alone cannot certify billing accuracy,
released clinical reports, lab instrumentation, physical barcode workflow or
qualified critical-result communication.

**F7 current gate: BLOCKED_PENDING_PRIVATE_ISOLATED_STAGING for screenshots,
F7 human visual and interactive review NOT_EXECUTED. F8 operational GO=NO_GO.**

No Hostinger F6 build SHA or production/offsite restore verification is
claimed by this source-only F7 increment.
