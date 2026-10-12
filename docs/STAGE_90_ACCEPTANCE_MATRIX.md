# Stage 90 — External Quality Assessment (EQA) / Proficiency Testing

## Master Scope provenance
`02_MASTER_SCOPE.md` §58 requires quality-management assessments and §§56–57 require separate QC controls, while §§1–2, 63–64, 79–80 require multi-branch tenancy, audit, and preservation of historical data. Current `main` has internal QC, nonconformances, CAPA, audits, training, equipment and all previously reported financial work; it had no persisted external proficiency program / rounds / submitted external sample evidence. This stage **adds a major end-to-end QMS capability**, rather than repeating existing aliquots/credit-notes/cashier/configuration import modules.

## Delivered workflow
- Branch-linked external proficiency **program registration**, code, provider and bilingual names with `qc.manage`. Historical programs are soft-deactivated only when all rounds are closed.
- Branch-linked **rounds** with provider round/sample codes, explicit timezone-offset submission deadline, creator and effective status OPEN → SUBMITTED → ASSESSED → CLOSED.
- EQA **observation entry** with analyzer (optional, active and same branch), active organization/department-scoped test component, code/English/Arabic/unit/analyzer snapshots, verbatim observed value, method, comments. Multiple readings/replicates per round use distinct entry codes.
- Draft observation **removal before submission only**, with reason and retained audit evidence. There is no destructive mutation of submitted evidence.
- **Submit** requires a nonempty round and a documented reason. Snapshot of every exact submitted measurement is retained in both observation and audit, along with operator/date.
- An independent user with `qc.resolve` must record **external provider assessment** for each observation (SATISFACTORY/UNSATISFACTORY/NOT_EVALUATED), expected value and provider feedback. They must be different from the round submitter **and the observation author**. Assessments are one-shot, preserving earlier verdicts; one independent reviewer completes an entire round.
- **Finalize** only if every observation has been assessed and an independent review reason is recorded; **close** records closure reason/user/date, including counts of unsatisfactory results. These are immutable transitions; no silent reassessment.
- All state changes happen in `Serializable` transactions with organization, active granted branch, program and round row locks. Domain and foreign-key constraints prevent cross-tenant/revoked-branch or invalid analyte/analyzer references. Permissions are `qc.view`, `qc.manage`, `qc.enter`, `qc.resolve` already present in the LIS; no new privilege defaults.
- Bilingual `/quality/eqa` console integrated with the QMS and application navigation, branch/program search, keyset rounds pagination and role-specific entry, review, closure and archive actions. Scoped component and analyzer options are provided.
- EQA is **external provider evidence**, not patient diagnostic values. Program/provider grading is operator-recorded; no automatic release hold, QC auto-blocking, patient result rewrite, guessed pass threshold or medical report change. Unsatisfactory evidence is available for documented follow-up, with existing nonconformance/CAPA workflow remaining authoritative.

## Data safety
- New additive Prisma models: `EqaProgram`, `EqaRound`, `EqaObservation` and enum `EqaRoundStatus`, `EqaAssessment`.
- Migration: `20261012165000_eqa_proficiency_testing`; three normalized tables, unique branch/program code, unique program/round code, unique round/entry code, FK constraints. No existing patient, invoice, released report, clinical result, price, test or QC row is altered.
- Strong audit for program/round and observation creation, removal of only open draft readings, submission, provider assessment, independent review, closure, retirement. Provider's numeric/text readings remain strings, not approximated as floating point; submitted test/unit/labels are snapshotted even if catalog later changes.

## Test acceptance matrix
1. Node `tests/stage-90-eqa-workflow-safety.test.ts`: strict length/no silent truncation, required 10+ char clinical reasons, no control chars, exact date offsets, reviewer independence, state transitions, all-readings assessment, presence of branch/department/analyzer/tenant/permission transaction locks and bilingual UI.
2. Real MariaDB `tests/stage-90-eqa-workflow-mariadb.integration.test.ts`: foreign organization/branch exclusion; program/round and multiple tables via real FK; analyzer component label snapshots survive catalog change; two concurrent connections prove round locking; submitted/assessed/closed persistence; irreversible one-time external grading; separate submission and review users; audited immutable history.
3. Full CI migration deploy/status/generate, safety suite, all earlier clinical/financial/specimen MariaDB tests, TypeScript, lint, RTL/LTR guard, Next.js production build. Success required on final feature SHA **and** merged main SHA.

## Deployment / acceptance
- Additive migration **required** on Hostinger: take a verified backup, run existing Prisma migration deploy process; no new environment variables.
- Clinical expert verification of external program setup, analyzer/device test, physical external-provider score delivery and human acceptance are deferred until full-system UAT. Successful software CI is not proficiency-provider certification.
- Existing Analyzer Bridge PR #128 stays **OPEN/DRAFT/unmerged**. Other open draft work is not copied, modified or merged.
