# Phase 6 Evidence Audit — Core Laboratory Results

Baseline audited: `389cc6cc93aa2625d017ee7e53da97c38e9665d3`

Audit rule: existing behavior is treated as evidence only when it is present in the live `main` codebase. Phase boundaries remain those in the master roadmap.

## Evidence matrix

| Scope item | Status at baseline | Evidence | Confirmed gap / note |
| --- | --- | --- | --- |
| Department worklists | Partial | `src/app/worklists/page.tsx` | Branch and department authorization already enforced. Baseline filters only search, department and order-item status. Branch, priority/STAT, specimen state, analyzer and due/TAT filters are not all exposed. |
| Generic manual result entry | Implemented | `src/app/worklists/[orderItemId]/page.tsx`, `src/components/result-entry-form.tsx`, `src/app/api/results/route.ts` | Uses the generic test/component model and server-side validation. |
| Keyboard-oriented entry | Partial | `src/components/result-entry-form.tsx`, `src/components/bulk-result-entry.tsx` | Native Tab works, but baseline has no explicit Enter-to-next workflow. |
| Bulk result entry | Implemented | `src/components/bulk-result-entry.tsx` | Saves each row through the same result API and clinical rule path as individual entry. |
| Numeric / qualitative / text results | Implemented | `ResultType`, `src/lib/result-value-parser.ts` | Boolean and date types are also supported. |
| Comments / reusable templates | Partial | `ResultCommentTemplate`, result workspace | Result-level comments and reusable templates exist. Component-scoped template storage exists, but the current entry UI inserts templates into the result-level comment and currently selects English template text only. |
| Reference flags | Partial | `ResultFlag`, `src/lib/result-reference.ts` | Numeric Normal/Low/High/Critical Low/Critical High are implemented. Positive/Negative and explicit manual/analyzer flag provenance are not modeled. Non-numeric values currently default to `UNKNOWN`. |
| Critical values | Partial | Reference interval critical low/high + critical event/communication workflow | Numeric critical detection, acknowledgement and communication exist. Configurable qualitative/text critical rules are not yet represented by the current result-value path. |
| Technical review | Gap | Current `VERIFY` path | A single `VERIFIED` state currently represents review. No distinct technical-review state/actor is modeled. |
| Medical validation | Gap | Current `VERIFY` / `RELEASE` paths | No distinct medical-validation state/actor is modeled. This must not be inferred from generic verification without an explicit clinical workflow design. |
| Department/test-specific validation paths | Gap | Validation holds exist, but are not a staged validation-path model | Requires a dedicated safety design for required review stages and role/permission gates. |
| Incomplete / pending tracking | Implemented baseline | `DRAFT` vs `ENTERED`, completeness check in result API, worklist summary | Filtering semantics can be improved later, but incomplete results are not silently treated as complete. |
| Result history / versioning | Implemented baseline | `LaboratoryResult.version`, amendment chain, release/amend APIs, report versions | Released values are locked and changes require amendment/versioning. Draft edits are audited. |
| Specialized result UIs | Gap | No CBC/Urine/Stool/Semen/Coagulation/etc. specialized UI found on baseline | Build as specialized UI over the generic model, not specialty-specific result tables. |
| Analyzer result staging/import | Existing foundation | Analyzer staging/import APIs and raw message storage | Protocol/Bridge expansion stays in Phase 10. Analyzer assignment semantics for a worklist filter are not yet modeled. |
| Calculated/reflex/delta/autoverification | Existing advanced foundation | Existing rules/services | These capabilities remain Phase 11 scope for completion/audit even though foundations already exist. |
| Reporting/delivery | Existing foundation | Result release creates report versions | Phase 7 remains responsible for report/delivery completion. |
| Microbiology | Existing foundation | Dedicated microbiology models/UI | Phase 9 remains responsible for microbiology completion. |

## Phase 6A — Runtime accepted

Runtime acceptance confirmed on Hostinger for main commit `d02850e73697623afbae073bde84f5b9fc8ea922`.

This batch intentionally avoids changing clinical validation semantics.

Implemented in branch `phase-6a-worklist-keyboard-controls`:

1. Worklist branch filter constrained to the user's active branch scopes.
2. Worklist priority filter including `STAT`.
3. Worklist ready-specimen state filter for `RECEIVED` / `IN_PROCESS`.
4. Visible priority column.
5. Enter-to-next navigation for single and bulk manual result entry while preserving native Tab behavior and multiline textarea entry.
6. Unit safety coverage for keyboard advance rules.

## Explicitly not included in Phase 6A

- Analyzer worklist filter: there is no reliable analyzer-assignment field for pending work items yet. Filtering by a result's analyzer would be misleading before a result exists.
- Due/TAT worklist filter: the catalog has `tatMinutes`, but a production filter needs an explicit, stable TAT clock basis/snapshot rather than a UI-only approximation.
- Technical Review / Medical Validation: clinically significant state and permission design; requires a dedicated Phase 6 batch.
- Positive/Negative/manual/analyzer flag semantics: requires schema/API design and historical snapshot rules.
- Specialized entry UIs: separate later Phase 6 batches.
- Advanced calculated/reflex/delta/autoverification completion: Phase 11.
- Full Analyzer Bridge protocol work: Phase 10.
- Report/delivery completion: Phase 7.
- Full microbiology workflow: Phase 9.

## Safety conclusions

- Do not replace `VERIFIED` with guessed review semantics.
- Do not expose an analyzer filter until pending analytical work has a true analyzer assignment/routing concept.
- Do not compute a clinically authoritative TAT deadline from mutable catalog values at display time; a future implementation should preserve the effective TAT context used for that work item.
- Continue to require active specimen-test lineage and current-custody branch checks before result entry.
- Released results remain amendment-only.


## Phase 6B — Runtime accepted

Runtime acceptance confirmed on Hostinger for main commit `3146b776c383e875aed03f32eefd14469c902b20`.

Phase 6B delivered configuration-driven qualitative result semantics.

Scope:
- configuration-driven qualitative result options per simple test or qualitative component;
- effective-dated option configuration with soft deactivation/reactivation and overlap protection;
- independent polarity flag (`POSITIVE` / `NEGATIVE`) and abnormality snapshot so polarity is never assumed to mean abnormal;
- independent critical-result configuration for qualitative options;
- manual and bulk entry constrained to active configured options when options exist;
- Analyzer import exact matching by option code, English label, or Arabic label when qualitative options are configured;
- historical snapshots for option code, bilingual labels, flag source, abnormality and critical state;
- amendment and diagnostic-report snapshots preserve the qualitative semantics;
- bilingual reusable comment template insertion in the result workspace;
- safety tests for polarity/abnormality semantics and autoverification behavior.

Clinical guardrail:
`POSITIVE` and `NEGATIVE` are interpretations, not automatic abnormality states. `isAbnormal` is configured independently; critical implies abnormal. Existing historical numeric abnormal flags are backfilled during migration.


## Phase 6C — Runtime accepted

Runtime acceptance confirmed on Hostinger for main commit `088470b5a234c038ea91049eb4dda0ae016365e1`.

Phase 6C delivered context-aware result comments.

Scope:
- result-level comments remain on `LaboratoryResult`;
- component-level comments are stored on `LaboratoryResultValue` and therefore remain tied to the exact historical value/version;
- organization/test comment templates can only populate the result-level comment;
- component templates can only populate the matching component comment;
- comment-template scope is enforced in the UI even if a future query returns a broader set;
- bulk result entry preserves existing component comments when it does not submit component-comment fields;
- an explicit empty component comment clears the comment, while an omitted field preserves it;
- amendment drafts copy component comments from the released version;
- diagnostic report snapshots preserve component comments;
- internal and portal report views render component comments;
- FHIR R4 DiagnosticReport export carries component comments into `Observation.note`;
- comment templates support audited soft deactivation/reactivation rather than deletion.

Clinical/data-integrity guardrail:
component comments are versioned with result values. Later template edits or deactivation do not rewrite historical result comments or released reports.


## Phase 6D — Runtime accepted

Runtime acceptance confirmed on Hostinger for main commit `74b2129a9d80aaaf5219ba78c908217bab962547`.

Phase 6D delivered the configurable specialized result-layout foundation.

Scope:
- adds a per-test result-entry layout mode: `STANDARD`, `SECTIONED`, or `COMPACT_GRID`;
- adds configuration-driven bilingual result sections inside a test;
- components can be assigned to a configured section without changing the generic result-value model;
- result workspace groups components by active section in configured order;
- components with no section or a deactivated section remain visible under Other / Ungrouped;
- section creation, component assignment, layout changes, deactivation and reactivation are audited;
- existing tests remain `STANDARD` after migration, so no current workflow changes automatically;
- pure grouping tests protect against hidden components when section configuration changes.

Architecture guardrail:
specialized CBC, urine, stool, semen, coagulation, hormone, tumor-marker and serology workspaces must be configured through generic layout/section metadata. They must not depend on hard-coded test names and must not introduce per-test result tables.


## Phase 6E — Runtime accepted

Runtime acceptance confirmed on Hostinger for main commit `4afe960df387c3d7364f1969a4993c9e54a2678a`.

Phase 6E delivered staged technical review and medical validation.

Source-aligned workflow:
- technical review is always part of the result validation path;
- medical validation is required only when the effective validation policy says so;
- validation policies may be configured at organization, department, or test level;
- precedence is `TEST > DEPARTMENT > ORGANIZATION`;
- when no explicit policy exists, the safe compatibility default is technical review only;
- `ResultStatus.VERIFIED` means the required validation path is complete. Technical and medical stages are represented separately by `validationStage`.

Historical integrity:
- the effective validation policy is snapshotted on the result once the path is established;
- technical reviewer, medical validator, timestamps, and immutable review events are retained;
- pre-Phase-6E verified/released/amended results are migrated as `COMPLETE` with a `MIGRATED_BASELINE` snapshot that explicitly states the old policy is unknown rather than fabricating historical review semantics;
- amendment drafts start a fresh validation path and never inherit approval actors from the released version.

Authorization and safety:
- `results.technical_review` and `results.medical_validate` are separate permissions;
- roles that already had legacy `results.verify` inherit technical-review permission for compatibility;
- medical-validation permission is initially granted only to `SYSTEM_ADMIN` and can be delegated through normal role management;
- by default the medical validator must be a different user from the technical reviewer; a policy must explicitly allow the same user;
- values are locked after technical approval while medical validation is pending;
- a medical validator may return the result for correction only with a recorded reason; the prior review remains in history and the result returns to technical review;
- release requires both `ResultStatus.VERIFIED` and `validationStage=COMPLETE`;
- critical communication can start after technical review even while medical validation remains pending;
- analyzer QC and blocking validation holds are rechecked at medical validation.

Autoverification compatibility:
- an eligible autoverification decision is treated as an automated technical review;
- if medical validation is not required, the result completes validation as before;
- if medical validation is required, autoverification stops at `MEDICAL_VALIDATION` and cannot bypass the human medical stage.


## Phase 6F — Runtime accepted

Runtime acceptance confirmed on Hostinger for main commit `fdb0ce3b6d16120e9b5d7859eb8afaaf1ce4cdb0`.

Phase 6F delivered immutable TAT snapshots and due-time worklist filtering.

Scope:
- every newly registered order item snapshots the effective catalog TAT minutes inside the same order transaction;
- TAT timing context is explicit and historical: minutes, clock basis, clock start, due timestamp, and snapshot source are stored on `OrderItem`;
- current Phase 6 operational clock basis is explicitly `ORDERED_AT`; this is an operational worklist SLA and is not silently presented as a specimen-receipt TAT metric;
- new tests with no catalog TAT are stored as `NOT_CONFIGURED`;
- pre-Phase-6F order items are migrated as `MIGRATED_BASELINE` with no fabricated TAT minutes or due timestamp, because their historical catalog value cannot be recovered safely;
- later changes to `LabTest.tatMinutes` do not alter existing order-item due times;
- server-side catalog validation rejects invalid negative/out-of-range TAT values;
- worklists add a Due/TAT column and filters for `OVERDUE`, `PENDING`, and `NO_TAT`;
- completed/verified work is never labelled overdue by the work-state helper;
- due timestamps are displayed in the ordering branch timezone;
- order registration audit captures the exact TAT snapshot used for each created order item.

Architecture guardrail:
future collection-started or reception-started TAT clocks must be introduced as explicit clock-basis policies and snapshotted on the work item. They must not recompute historical deadlines from mutable catalog configuration.


## Phase 6G — Runtime accepted

Runtime acceptance confirmed on Hostinger for main commit `47c8b747c8722fc84c7cea9d09d201f9b3a92abb`.

Phase 6G delivered explicit analyzer work routing and analyzer-filtered worklists.

Scope:
- introduces explicit current analyzer routing for pending `OrderItem` work rather than inferring an analyzer from a result that already exists;
- one work item may be routed to multiple analyzers, supporting tests whose mapped components can be produced by more than one device;
- each active route snapshots analyzer code, name, and branch;
- immutable route events retain every ASSIGNED/CLEARED action, actor, timestamp, and clear reason;
- generic audit events mirror routing changes;
- adds separate `worklists.route` permission; it is initially granted to `SYSTEM_ADMIN` only and can be delegated through normal role management;
- assignment is allowed only when the analyzer is active, in the current ready-specimen branch, compatible with the test department when department-scoped, and has an active effective mapping for the LIS test;
- completed/locked work cannot be rerouted;
- worklists display current analyzer routes and provide an Analyzer filter including an explicit Unassigned state;
- analyzer result staging remains backward-compatible when no route exists;
- once one or more explicit routes exist, incoming analyzer observations are accepted only from an assigned analyzer;
- route removal requires a reason and never erases route history.

Phase boundary:
this batch supplies LIS-side pending-work routing and worklist filtering only. Serial/TCP/file connectivity, bidirectional order download, bridge transport behavior, retries, and device protocol completion remain Phase 10 Analyzer Bridge scope.


## Phase 6H — Configurable specialized result presentation

Phase 6H is implemented on feature branch `phase-6h-specialized-result-presentation` and is pending CI/runtime acceptance.

Scope:
- extends the generic result-layout system with presentation metadata that can produce optimized workspaces for CBC/hematology, urine, stool, semen/fertility, coagulation, Widal/TORCH/serology, tumor markers, hormones, PCR, bone marrow, CSF and other configured specialties;
- each configured result section can use 1–4 compact-grid columns and bilingual operator guidance;
- each test component can independently use AUTO, NARROW, STANDARD, WIDE or FULL-row entry width plus bilingual operator guidance;
- presentation configuration is managed from the Test Catalog and audited;
- the same generic `LaboratoryResult` / `LaboratoryResultValue` model and existing result API remain unchanged;
- result types, qualitative options, reference intervals, critical rules, comments, delta context, calculated values and validation workflow continue to use their existing generic paths;
- inactive or missing sections still fall back to Other/Ungrouped and never hide components;
- compact layouts collapse responsively on smaller screens;
- tests preserve section metadata and verify ungrouped fields do not inherit another section's presentation.

Architecture guardrails:
- no runtime logic branches on test names such as CBC, Urine, Stool or Semen;
- no specialty-specific result storage tables are introduced;
- presentation hints are operator UI guidance only and do not replace reference intervals, critical limits, units, calculation rules or validation policies;
- changing presentation later does not rewrite historical result values or released reports;
- microbiology culture workflow remains Phase 9, while Analyzer Bridge protocol/connectivity remains Phase 10.

With Phase 6H runtime acceptance, the Phase 6 Core Laboratory Results scope is functionally covered by the generic result model plus configurable specialized presentation. Advanced calculated/reflex/delta/autoverification completion remains Phase 11 by roadmap boundary.
