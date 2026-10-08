# Stage 7 — Laboratory Worklists and Results Acceptance Matrix

**Baseline:** main `e6f2ad9c114bd109d0bb926b689e6172bc38f974` (Stage 6 deployed/confirmed by owner).  
**Working branch:** `stage-7-laboratory-results-completion`.

This stage uses the project handoff's Stage 7 boundary, which maps to the **Core Laboratory Results** functional area in `07_IMPLEMENTATION_ROADMAP.md` (there labelled *Phase 6*). Do not confuse it with the roadmap's reporting/delivery Phase 7, which is the next project Stage 8.

The existing repository already contains much of the Core Laboratory Results capability. The earlier `docs/PHASE_6_EVIDENCE_AUDIT.md` records substantial implementation and historical runtime acceptance. Stage 7 is a **delta/clinical-concurrency hardening stage**, not a second implementation with parallel tables.

| Requirement | Live baseline evidence | Stage 7 additional verification |
| --- | --- | --- |
| Department and branch worklists | `src/app/worklists/page.tsx` | Preserve tenant + department + current custody branch scopes; priority/STAT, specimen, analyzer, TAT filters |
| Generic and bulk result entry | `src/app/api/results/route.ts`, `src/components/result-entry-form.tsx`, `src/components/bulk-result-entry.tsx` | Concurrent editing vs clinical review must not silently change validated values |
| Specialized clinical entry | Catalog-defined sections, layout and bilingual hints | No CBC/urine-specific database tables or name-based hardcoding |
| Reference flags, critical limits | `src/lib/result-reference.ts`, result value snapshots | Worklist preview must use immutable order demographics and order-time age context and current effective reference policy, consistent with result entry; existing result uses stored range snapshot |
| Comments and templates | Reusable templates and component notes | Bilingual rendering and audit context |
| Technical review | `src/app/api/results/[id]/verify/route.ts` | Exact revision CAS before review event; locked specimen readiness/custody |
| Medical validation | `src/app/api/results/[id]/medical-validate/route.ts` | Explicit action; exact revision CAS for approve/return; prevent duplicate review events |
| Incomplete/pending | DRAFT/ENTERED/validationStage and worklist summaries | Never mistake medical-review-pending for fully verified |
| Result history | Versioned `LaboratoryResult`, amendment chain and report versions | No mutation of RELEASED history; retain reviewer events |
| Quarantine intersection | Stage 6 QUARANTINED specimen and fail-closed result release | Technical and medical reviews must not authorize currently quarantined/transferred specimens |

## Additional engineering work started

1. Correct reference-interval preview in the worklist detail page to use `patientSexSnapshot`, `patientDobSnapshot`, recorded-age snapshots and `orderedAt` as age context, but use the current effective date for reference policy selection as the entry API does.
2. Prevent duplicate technical and medical reviews using an optimistic compare-and-swap against status, validation stage, `updatedAt` and organization, within the same transaction as clinical review/audit events.
3. Lock the specimen row during technical and medical validation; disallow **technical review and medical approval** when sample status is not `RECEIVED`/`IN_PROCESS` or its current branch no longer matches the performing branch. Medical RETURN for documented correction remains allowed after quarantine (it cannot approve or release a result).
4. Reject malformed medical-validation actions instead of treating any value as an approval.
5. Add automated fail-closed regression coverage.

## Release gates

- No downgrade to generic-only review, no invented clinical defaults, and no hardcoded test-name logic.
- CI success on **exact branch HEAD**: MariaDB migration/status, safety tests, TypeScript, lint, bilingual UI and production build.
- No manual operator/printing/scanner UAT required at this stage; owner explicitly defers all manual UI/device UAT to whole-project acceptance. This deferral does not represent clinical production sign-off.
- Remain draft until remaining Stage 7 clinical concurrency and acceptance items are closed; no merge/deploy without passing gates.
