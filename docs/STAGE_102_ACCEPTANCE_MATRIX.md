# Stage 102 — Multi-Branch Organization Structure Administration

## Baseline and scope

- Base: Stage 101 merged main `98480761e90c4851396486308fbe9dbed57ddd93`, independent main CI #1168 SUCCESS.
- Master Scope §§1–2: organization > branches > departments/workstations, administrator configuration, working hours per branch, shared master data, role/branch isolation.
- Existing Prisma Branch, BranchSetting, Department, Workstation, UserBranchScope and AuditEvent are reused, with **no migration**. Branch identity and relations already exist and must not be copied to new tables.

## Implemented

1. `/organization/branches`: bilingual RTL/LTR, navigation permission-scoped, read/create/edit for branches, departments, workstations. Physical location, timezone, original currency and central lab designation are explicit. Branch and department/workstation codes are immutable after creation. No master data is hard deleted.
2. `/api/organization/branches`: organization-wide create requires active SYSTEM_ADMIN plus `branches.manage` and an active scoped branch; assigns new branch to creator in same transaction, audits actor and immutable branch identity. Detail editing and deactivation/reactivation are also organization-admin only. Reads for ordinary staff are restricted to their active branch memberships.
3. Per-branch `working_hours_v1` JSON in existing `branch_settings`: seven named ISO weekdays, ordered nonoverlapping local-clock windows, max four/day, explicit full-day representation allowed. No implicit lab/clinical retention time or clinical TAT change. Can be updated by authorized branch managers with `branches.manage`, audited with the previous JSON.
4. `/api/organization/departments`: active branch-scoped admins can create/edit local departments, SYSTEM_ADMIN can also create shared departments. Shared vs local scope and code cannot be silently changed once linked; deactivation is rejected when active tests, analyzers, equipment, workstations, department access scopes or validation policies reference that department.
5. `/api/organization/workstations`: list only authorized organization/branch workplaces, local creation/update, immutable code and branch, current active same-tenant department must be either shared or within the same branch. Status is softly deactivated/reactivated with recorded reason.
6. Branch deactivation intentionally **fails closed**, allowing only unused locations: not the current active workspace, not the final active branch and no linked orders, performed work, specimens, invoices, stock, equipment, analyzers, user scopes, active departments/workstations, appointments, or transfer manifests. An established branch needs a separate governed closure/transfer project; historical references are never destroyed.
7. Serializable transactions, live actor/scope/organization checks, row locking, immutable code, audit before commit. All APIs perform server-side validation independent of UI.

## Automated verification and deployment

- Node contract tests: `tests/stage-102-organization-structure-safety.test.ts` in `npm run test:safety`.
- Real two-connection MariaDB tests: `tests/stage-102-organization-structure-mariadb.integration.test.ts`, CI dedicated step, testing cross-tenant/branch filtering, FK-backed hierarchy, unique working-hours key, and branch lock concurrency.
- Mandatory: full CI on exact final feature SHA then full independently green main CI after merge. No migrations added; preserve staging/production database backup before deploying. User manually validates Hostinger; no claim of deployment from CI alone.
- Clinical and operational acceptance, local hours policy approval, printed labels, analyzer bridging, booking capacity, branch closure logistics, and regulatory validation remain pending final UAT; branch working-hours metadata does not itself schedule appointments or change historical TAT.

## Protected unrelated work

Draft PR #128 Analyzer Bridge, Draft PR #209 report interpretations and Draft PR #224 legacy recall quality queue remain untouched/unmerged.
