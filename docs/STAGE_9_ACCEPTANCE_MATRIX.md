# Stage 9 — Microbiology engineering acceptance

**Baseline:** `main` at `35270c48e32e269902f37dbbf038578772f5e8dc` (Stage 8 owner-confirmed successful deployment).  
**Working branch:** `stage-9-microbiology-completion`.

The project already had culture cases, organism/antibiotic catalogs, observations, isolate records, AST panels, preliminary/final workflow, integration into versioned `LaboratoryResult`, and immutable clinical report snapshots. Stage 9 completes and hardens this existing foundation; it must not duplicate these entities.

| Capability | Implementation / stage safety contract | Acceptance |
| --- | --- | --- |
| Case registration and test/catalog compatibility | `/api/microbiology/cases`: test must have MICROBIOLOGY workflow, linked specimen and performing-branch scope. Stage 9 locks specimen and rechecks status, custody and active order/specimen relationship *inside* transaction; parallel case creation resolves to safe conflict | Automated/MariaDB |
| Culture and preliminary observations | Versioned case status plus append-only observations and author/time audit. Mutations serialize on the specimen and parent case; after final result submission observations cannot diverge from the submitted snapshot | Automated/MariaDB |
| Organism identification and isolate numbering | Organization-scoped active organism catalog; allocate sequential isolate numbers while parent case locked; prevent status NO_GROWTH while isolates exist | Automated/MariaDB |
| Antimicrobial susceptibility (AST) | Organization-scoped active antibiotic catalog; method, MIC, MIC unit, zone diameter, source interpretation and manually recorded breakpoint snapshot. Preserve full submitted decimal precision. Reject unknown interpretation codes rather than coercing to UNKNOWN | Automated/MariaDB |
| Breakpoints / antibiotic interpretation | No S/I/R auto-calculation without approved, versioned CLSI/EUCAST/local standard rules. Manual interpretation must be explicit. No hardcoded clinical breakpoints or silent inferred therapeutic advice | Clinician policy deferred |
| Result bridge | Case status, isolate/organism/AST snapshots become the versioned `LaboratoryResult` submitted for independent technical/medical validation and report release | Automated/MariaDB |
| Clinical revision consistency | All writes and final submissions claim live specimen custody and lock case state, with `updatedAt` conflict checks. Existing draft result updates claim exact editable version before replacing clinical values | Automated/MariaDB |
| Safe correction/withdrawal | Only unverified, unreviewed submitted result may be cancelled with retained version/audit. A correction withdrawal does not bypass release; permitted after physical specimen quarantine as a record-correction action | Automated/MariaDB |
| Release/amendment | Generic controlled verification/release, immutable report versions and amendment workflow apply to microbiology. FINAL/CANCELLED cases lock further edits | Automated; clinical UAT deferred |
| Arabic/English | Existing bilingual forms with new locale-specific clinical edit and revision conflict guidance | Automated checks |

## Required release checks

1. Exact SHA CI: Prisma migrations/status, safety regression suite including `tests/stage-9-microbiology-safety.test.ts`, two-operator MariaDB integration `tests/microbiology-mariadb.integration.test.ts`, TypeScript, ESLint, RTL/LTR and Next.js production build.
2. Never treat browser-level UAT, physical sample culture testing or clinician breakpoint interpretation as completed by CI alone. Owner explicitly postpones **all manual UI/hardware testing** to the project's full-system acceptance.
3. Clinical breakpoint applicability, methodology and critical microbiology escalation policies require authorized laboratory review before live clinical use. The implementation must remain fail-closed where such policy is missing, rather than invent rules.
4. Report/AST snapshots are immutable after release. Corrections use the versioned amendment workflow, not direct edits.
5. Merge into `main` only after exact-HEAD CI success; verify the merged commit's CI and let the owner confirm the automatic Hostinger deployment, as in earlier stages.

## Findings and fixes tracked

- Existing culture and susceptibility POST routes checked case state before the transaction, allowing a second operator to finalize/submit while a first action appended clinical records. Stage 9 introduces transactional row locks and result-linked mutability gates.
- Existing isolate sequence allocation was outside the transaction and could collide under simultaneous requests. Allocation now happens after a locked case claim.
- Existing susceptibility parsing converted MIC and zone values to JS numbers and coerced unknown interpretation codes to UNKNOWN. Inputs now retain validated decimal representations, require explicit valid codes and a MIC unit when MIC is supplied.
- Submission and withdrawal previously updated an existing result without an exact revision compare-and-swap. They now prevent writes after concurrent review or changed case state.
- Missing clinical policy is explicitly tracked, not falsely treated as an approved breakpoint database.
