# Family Lab LIS — Pilot & Acceptance Execution

Date: 2026-10-05  
Baseline: `main` @ `2425f8a7d1d1784a98e3cb2ed55a6727e639e2b4`  
PR baseline: #66 merged  
Purpose: move from technical production readiness to controlled pilot acceptance without expanding functional scope.

## Acceptance status vocabulary

- **PASS-AUTO** — verified by executable CI/safety checks.
- **PASS-CODE** — production path and persistence model inspected and consistent with the acceptance requirement.
- **PENDING-RUNTIME** — requires an actual running pilot environment and representative configuration/data.
- **PENDING-HUMAN** — requires authorized laboratory/business sign-off.
- **FAIL** — reproducible defect or unsafe behavior; must be fixed before production approval.

## Baseline evidence

| ID | Acceptance item | Status | Evidence |
|---|---|---|---|
| BASE-01 | `main` equals pilot-acceptance baseline merge commit | PASS-AUTO | Git history: `2425f8a7d1d1784a98e3cb2ed55a6727e639e2b4` is current baseline |
| BASE-02 | PR #66 merged | PASS-AUTO | Pilot acceptance baseline merged into `main` |
| BASE-03 | MariaDB migration chain | PASS-AUTO | CI run #210 completed successfully |
| BASE-04 | Prisma generation | PASS-AUTO | CI run #210 completed successfully |
| BASE-05 | Safety-critical tests | PASS-AUTO | CI run #210 completed successfully |
| BASE-06 | TypeScript | PASS-AUTO | CI run #210 completed successfully |
| BASE-07 | ESLint | PASS-AUTO | CI run #210 completed successfully |
| BASE-08 | Full Next.js production build | PASS-AUTO | CI run #212 completed successfully with `npx next build` |
| BASE-09 | `prisma migrate status` after deploy | PASS-AUTO | CI run #212 completed successfully |

## Pilot scenarios

### PA-001 — Patient → Order → Billing → Specimen planning

**Expected**
1. Existing central patient can be selected from any authorized branch.
2. Order is created only inside the user's branch scope.
3. Price precedence resolves deterministically.
4. Mixed currencies are rejected.
5. Order, order items, invoice, invoice lines, question snapshots and specimen plans are committed atomically.
6. Historical price/name/unit snapshots remain attached to the transaction.

**Current status:** PASS-CODE / PENDING-RUNTIME

**Runtime evidence required**
- accession number
- invoice number
- selected price-list scope
- currency
- specimen barcode(s)
- audit/event records
- screenshots or exported evidence from pilot session

### PA-002 — Payment and billing reconciliation

**Expected**
- partial/split settlement is allowed according to configured payment methods;
- payment is branch-scoped;
- financial history is append/audit oriented;
- historical invoice totals are not recomputed from later prices.

**Current status:** PASS-CODE / PENDING-RUNTIME

### PA-003 — Barcode → Collect → Receive

**Expected**
- specimen collection is allowed only from `PLANNED`;
- specimen type must be configured before collection;
- receive is allowed only from `COLLECTED` or `IN_TRANSIT`;
- custody events retain branch/user/status transitions.

**Current status:** PASS-AUTO / PENDING-RUNTIME

### PA-004 — Specimen rejection and recollection

**Expected**
- rejection is allowed only from valid specimen states;
- rejection reason is mandatory;
- recollection remains traceable to the rejected specimen/order context.

**Current status:** PASS-AUTO / PENDING-RUNTIME

### PA-005 — Worklist → Result entry → Verification

**Expected**
- result is associated with the ordered test and performing branch;
- reference interval/flags are evaluated from effective clinical configuration;
- critical, delta, reflex and validation-hold state is retained with the result context;
- unauthorized branch access is rejected.

**Current status:** PASS-CODE / PENDING-RUNTIME

### PA-006 — Result release

**Expected**
- only `VERIFIED` result versions can be released;
- analyzer QC `BLOCK` prevents release;
- critical result requires acknowledgement before release;
- report release creates immutable diagnostic report history.

**Current status:** PASS-AUTO / PENDING-RUNTIME

### PA-007 — Critical result communication

**Expected**
- critical event is opened by the workflow;
- contact/communication can be recorded;
- acknowledgement is required before release;
- audit trail remains available.

**Current status:** PASS-AUTO / PENDING-RUNTIME

### PA-008 — Amendment/versioning

**Expected**
- only a released result can enter the normal amendment workflow;
- original released version is preserved;
- a newer result version prevents a second parallel amendment;
- amended reporting produces a new version;
- microbiology follows its dedicated amendment policy.

**Current status:** PASS-AUTO / PENDING-RUNTIME

### PA-009 — Multi-branch scope

**Expected**
- central patient identity is organization-wide;
- operational order/specimen/result/invoice data remains branch-scoped;
- users cannot access branches outside their explicit scope;
- active branch switching is validated for multi-branch users.

**Current status:** PASS-AUTO / PENDING-RUNTIME

### PA-010 — Inter-branch specimen transfer

**Expected**
1. Create manifest from source to destination branch.
2. Add eligible specimen(s).
3. Dispatch with custody evidence.
4. Specimen changes to in-transit/current-location state as designed.
5. Destination scans and reconciles expected vs received.
6. Result can later be performed at destination while ordering branch remains preserved.

**Current status:** PASS-CODE / PENDING-RUNTIME

### PA-011 — Price precedence and historical snapshots

**Expected**
- precedence is `CONTRACT > CLIENT > BRANCH > ORGANIZATION`;
- priority and effective date only decide between candidates within the same scope;
- transaction snapshots are not changed by later catalog/price edits.

**Current status:** PASS-AUTO / PENDING-RUNTIME

### PA-012 — Reference ranges and critical limits

**Expected**
- effective-dated clinical configuration is selected from patient/test context;
- released result/report stores the clinical display context used at release;
- later range/unit/name edits do not silently change an old report.

**Current status:** PASS-CODE / PENDING-RUNTIME

### PA-013 — Analyzer import without physical analyzer

**Expected simulated workflow**
1. Stage normalized analyzer observation using barcode/order/specimen identity.
2. Resolve effective analyzer-to-LIS mapping.
3. Preserve raw/interface provenance and import identity.
4. Enforce unit/mapping validation.
5. Import to versioned LIS result.
6. Apply reference/delta/calculated/reflex/validation-hold logic.
7. Apply QC gate before autoverification/release.

**Current status:** PASS-CODE / PENDING-RUNTIME

**Physical analyzer later**
- protocol/transport handshake
- actual barcode behavior
- vendor message quirks
- disconnect/retry/replay
- bidirectional order download where supported
- analyzer-specific flags and units

### PA-014 — QC release gating

**Expected**
Release/autoverification is blocked when any applicable condition requires it, including:
- equipment not active;
- open downtime;
- failed/in-progress/due calibration;
- missing/stale/failed QC;
- inactive/expired QC lot;
- open blocking QC violation.

Warnings must remain distinguishable from blocks.

**Current status:** PASS-AUTO / PENDING-RUNTIME

### PA-015 — Backup/restore and disaster recovery

**Expected**
- backup creation is provided by infrastructure, not falsely claimed by an LIS metadata record;
- restore is tested into an isolated environment;
- migration status is checked before migrations are applied;
- patient/order/specimen/report/audit history is smoke-tested after restore;
- actual RPO/RTO and evidence are recorded.

**Current status:** PASS-CODE / PENDING-RUNTIME

### PA-016 — Security / production secrets / MFA

**Expected**
- production `APP_ENCRYPTION_KEY` is a real secret;
- staff admin MFA is enabled according to policy;
- default credentials are removed/disabled;
- HTTPS and security headers are active;
- authentication rate limiting is working;
- integration secrets/API keys are scoped and protected.

**Current status:** PASS-CODE / PENDING-RUNTIME

## Pilot runtime environment

The controlled pilot runtime is the existing Hostinger Business Web Hosting deployment:

- **Application URL:** `https://familylab.wisamai.com`
- **Primary pilot path:** `https://familylab.wisamai.com/dashboard`
- **Source repository:** `Wisamit/family-lab-lis`
- **Production branch:** `main`
- **Runtime stack:** Next.js / Node.js with Hostinger MySQL/MariaDB
- **Data state:** no official laboratory production data has been entered yet, so representative pilot records may be created for acceptance testing.

Vercel is **not** part of the target deployment path and must not be treated as a pilot prerequisite.

### Current execution limitation

The assistant's current tool environment cannot directly reach the Hostinger application URL or hPanel, so runtime evidence that requires browser interaction must be executed on the Hostinger deployment and recorded against PA-001 through PA-016. GitHub/CI remains the authoritative automated gate for source, migration, build, lint, type and safety checks.

## Production approval rule

Production approval must not be granted only because source code and CI pass.

Minimum go-live gate:
1. all automated release gates pass on the exact release commit;
2. PA-001 through PA-016 are executed against a controlled pilot environment using representative configuration;
3. no open safety-critical or data-integrity defect remains;
4. backup restore evidence is recorded;
5. analyzer/QC workflow is validated at least in simulation and later against each real production analyzer;
6. authorized laboratory and business owners sign off.

## Defect handling during pilot

For every failure:
1. record acceptance ID and exact reproduction steps;
2. classify clinical safety / financial integrity / security / operational severity;
3. fix on a dedicated branch;
4. open a PR;
5. require full CI;
6. repeat the failed acceptance scenario;
7. merge only after the scenario passes;
8. retain the evidence and commit/PR reference in this document or the pilot evidence record.
