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


## Phase 6C — Context-aware result comments

Phase 6C is implemented on feature branch `phase-6c-result-comments-context` and is pending CI/runtime acceptance.

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
