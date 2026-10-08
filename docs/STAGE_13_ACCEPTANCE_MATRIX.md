# Stage 13 — Quality Management (QMS) integrity and acceptance

**Base:** Stage 12 merged `main` `d7ed796be63beb632c85e4dcb8a71783d8984fd8` (CI #838 success, Hostinger deployment confirmed by owner).  
**Scope:** `02_MASTER_SCOPE.md` §§58–62, QMS and ISO 15189-aligned traceability design; all remaining Master Scope obligations preserved.

## Existing modules audited

- Nonconformance/incident case records: category, source reference, severity, owners, causes, dispositions and audit.
- CAPA: case linking, corrective/preventive actions, effectiveness review, closure evidence.
- Controlled SOP/document lifecycle: draft, reviewed, approved, effective, retired versions; training/competency links.
- Training and analyzer authorizations: recorded assessment, authorization, suspension and training evidence.
- Internal audits/findings and quality indicators: audit lifecycle, findings, closure, measurements.
- Bilingual quality-management console; existing schema and workflows reused, no duplicate tables.

## Stage 13 safety increment

| Module | Baseline risk | Guard implemented |
|---|---|---|
| CAPA actions and effectiveness review | Preflight-only checks allowed action changes after or during closure | Serializable parent-row lock; re-read action status under lock; optimistic status/revision claim; atomic audit |
| Nonconformance closure and linked CAPA creation | New CAPA could be linked concurrently to a closing incident; branch context could disagree | Both workflows lock `nonconformances` row; recheck open CAPAs and current source state; require branch-scoped access and branch match |
| Internal audit completion and findings | New finding could arrive after audit's preflight closure count | Shared audit row lock and refreshed unfinished-finding count; conditional state transition |
| Finding closure | Repeat closure or linked unresolved CAPA could be marked complete | Conditional claim and audit parent lock; linked CAPA must already be CLOSED |
| SOP version activation | Simultaneous activations or older approved version overwrote a newer effective version | Lock document parent, check workflow source state, atomically transition and retire prior effective version; deny implicit rollback |
| Regression testing | No focused QMS MariaDB concurrency tests in CI | Source-level guard tests plus two-connection MariaDB transactional lock tests registered in CI |

## Release and clinical governance

- [ ] Final feature HEAD CI success: Prisma migration status, safety suite, MariaDB integration, TypeScript, ESLint, AR/EN UI and production Next build
- [ ] Ready for Review, merge using verified HEAD and confirm exact merged `main` CI success
- [ ] Verify deployed Hostinger SHA separately
- [ ] Manual UAT (screens/hardware/real lab audit), documentation review authority, signature/MFA policy, staff competency evidence and ISO 15189 quality accreditation acceptance: **DEFERRED until entire project is built**
- [ ] Continue any remaining QMS workflow and master-scope gaps in later completion audit, never silently remove scope
- [ ] Keep Analyzer Bridge PR #128 separate; stale base needs independent refresh and validation before future merge

**Clinical boundary:** Automation and CI certify software engineering behavior only; they do not certify corrective action effectiveness, SOP clinical appropriateness, staff proficiency, or laboratory compliance. No unapproved severity, escalation, retention or clinical policy has been invented.
