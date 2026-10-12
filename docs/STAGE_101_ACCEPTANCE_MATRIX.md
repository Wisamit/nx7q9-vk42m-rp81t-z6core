# Stage 101 — Governed Retained Specimen Disposal

## Baseline and verified gap
- Base: exact merged Stage 100 main `9730ea9cf34d3a95387fdf061183f977a14eb961`, independent CI #1157 SUCCESS (110/110).
- Scope evidence: `02_MASTER_SCOPE.md` §§22–28 (specimen custody, barcoding, storage, aliquots), §§41/58–60 (clinical audit, quality), §78 (retention and privacy). The existing `POST /api/specimens/[id]/dispose` intentionally allows only **REJECTED** specimens; accepted/released retained material has no governed disposal policy.
- Existing specimen collection, rejection, aliquoting, storage location, QMS, inter-branch transfer, clinical validation and report release are reused; this stage does **not** duplicate those modules or change released result history.

## End-to-end delivered
1. Additive FK-backed MariaDB `SpecimenRetentionPolicy` and `SpecimenDisposalCase` records. Policy is per tenant/branch/specimen type with explicit minimum full 24-hour retention days (1–73000), rationale, author, independent reviewer, effective approval timestamp and retirement chronology. **No default medical/legal duration is supplied.**
2. `POST/GET/PATCH /api/specimens/retention-policies`: `settings.manage` drafts policy; independent `quality.nonconformance.manage` reviewer approves/retire; approval serializes branch row locks, retires formerly active policy for same branch and type without rewriting historical terms. Every decision is audited.
3. `POST/GET/PATCH /api/specimens/disposal-cases`: `specimens.reject` requests against exact barcode in active/current authorized branch; `quality.nonconformance.manage` authorizes independently; a separately authorized specimen operator records execution evidence. Request, authorization and execution are distinct immutable provenance events with persisted explicit policy ID and retention due date.
4. **Prospective only**: Policy must have been approved by collection time. Missing or backdated policy fails closed. A currently approved policy must remain valid; retirement blocks new execution. No silent retroactive use of newly configured rules.
5. Safety at authorization/execute: lock the specimen and check the live tenant, branch and user scope; the specimen must be `RECEIVED`/`IN_PROCESS`, have known collection time and type, completed order, no pending test items, latest non-retracted FINAL/AMENDED report, no unsettled transfers/send-outs, no remaining physical child material, no unreleased associated results and no open specimen-linked QMS nonconformance. A stale specimen version blocks execution.
6. Execution transaction updates the specimen to `DISPOSED`, clears present storage assignment, increments preanalytical version, writes a `SpecimenEvent` with physical evidence and immutable `AuditEvent`; **no result/report/financial master changes**.
7. Bilingual AR/EN, RTL/LTR `/specimens/retention` with explicit no-default-policy notice and roles-based creation/review/authorization controls, linked from `/specimens`.

## Engineering acceptance
- `tests/stage-101-specimen-retention-safety.test.ts`: table-driven negative clinical gates, date precision, independent human roles, source contracts, audit, same-branch transaction and no accidental report/result edits.
- `tests/stage-101-specimen-retention-mariadb.integration.test.ts`: live MariaDB FK and minimum-duration check, organization/branch predicates, two-connection specimen `FOR UPDATE` concurrency, persisted audit-relevant identifiers and authorization not physically disposing material.
- CI includes Prisma migrate/status/generate, full safety suite, Stage 101 MariaDB, existing integration suites, TypeScript, lint, UI i18n/theme and production build. **Only exact last feature commit CI and independent merged-main CI count as passed.**

## Deliberately not inferred / follow-on obligations
- A case, event and typed physical disposal evidence are **staff attestations**; not proof that external clinical/legal retention, biological hazards, physical storage inspections, disposal contractors, freeze/thaw conditions, chain-of-custody inventories or physical stock destruction are validated.
- Site jurisdictional retention/legal-hold policy, biobank/material-specific restrictions, data protection/consent, independent signatory authority and actual physical disposal SOP must be approved by the laboratory before real clinical operations. **No policy is pre-seeded.** Existing open specimen-linked QMS cases block execution but the system does not claim comprehensive legal-hold registry integration.
- Previous rejected-only disposal remains unchanged; this feature governs retained accepted material separately. Existing result/report amendment and patient disclosure flows are not overridden.
- Pagination/older historic policy archival are limited to latest 100 scoped records in UI; server-side clinical writes never rely on a truncated listing.
- **Manual clinical/UAT, equipment, laboratory, physical custody and regulatory acceptance: DEFERRED** by owner until entire application is built. Hostinger is owner-deployed after main CI; take DB backup before applying additive migration `20261013001000_specimen_retention_disposal_governance`.
- Draft PR #128 Analyzer Bridge and #209 obsolete report interpretation remain untouched.
