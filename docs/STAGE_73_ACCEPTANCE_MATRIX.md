# Stage 73 — Transitive Patient Merge Lineage in Clinical History

## Baseline
- Started from verified `main` SHA `6f52688548ecdb8fea1b9103cbe758295143ab6b` (Stage 72, merged main CI #1036 SUCCESS; owner confirmed Hostinger deployment).
- Master Scope §§3–4 and §44 require immutable organization-wide patient identity, audited merges and complete accessible clinical history across permitted branches.
- Both `/patients/[id]/history` and report cumulative comparison previously followed at most one `mergedIntoPatientId` parent and one direct `mergedFrom` level. The normal merge transaction reparents direct aliases but cannot guarantee that historical, externally migrated or inconsistent multi-generation lineages are flat. This can hide earlier visits and values rather than showing a genuinely linked longitudinal record.

## Changes
- `src/lib/patient-identity-lineage.ts`: organization-scoped canonical traversal and descendant breadth-first closure; returns canonical patient and all historical aliases. Detects cycles, missing/foreign-tenant parent pointers, invalid ACTIVE merge links, duplicate/corrupt graph membership and excessive (>512) linked records; **fails closed** with explicit integrity error rather than truncating medical history.
- Uses a `RepeatableRead` transaction for coherent lineage discovery. History and cumulative companion views reuse exactly the same resolver. The original patient and order IDs, report snapshots and merge audit are **not changed**.
- Existing branch-level, department-level, `patients.view` and `reports.view` checks remain in place. A common organization identity is not carte blanche to read another branch's records.
- Explicitly preserves existing patient history pagination and Stage 72 current released report-value checks. Does not claim 20-report/page trend coverage to be a complete longitudinal plot.

## Verification
- `tests/stage-73-patient-identity-lineage.test.ts`: transitive canonical roots, multiple descendants, tenant isolation, missing links, cycles, corrupt active links, oversized graphs and source permission wiring.
- `tests/stage-73-patient-merge-lineage-mariadb.integration.test.ts`: actual MariaDB two-connection fixtures, A→B→C and sibling alias, tenant crossing corruption, organization/ordering-branch filtered orders, cycle and inactive-merge status safety.
- CI explicit MariaDB test added; retain all previous Prisma migrations, schema validation, unit/safety checks, TypeScript, ESLint, AR/EN UI and Next production build.

## Acceptance boundaries
- **Read-only** clinical history and report companion display. No schema migration, pricing, released result alteration, report amendment, or patient merge mutation.
- If legacy data contains corrupt/cyclic/incomplete linkage, the affected view fails closed and needs authorized identity/data-integrity investigation. The application does not guess historical linkage.
- Final manual UAT, clinical records reconciliation and production/device acceptance remain DEFERRED under owner instructions, not passed.
- PR #128 Analyzer Bridge remains separately OPEN/DRAFT; no code from it is merged.
