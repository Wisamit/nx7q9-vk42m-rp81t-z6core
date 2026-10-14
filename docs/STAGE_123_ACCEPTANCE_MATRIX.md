# Stage 123 — Organization-Wide Clinical Governance: No Branch/Department Scope Amplification

## Verified baseline and gap
- Base `main` is `9240a0c0b8657f8c751764ecaacd685b15c31646`; Stage 122 independent CI #1266 SUCCESS, Hostinger publish confirmed by owner.
- Master Scope §§2, 10–11, 38–41, 63–64, 75, 79–80.
- Prior Stage 120 reauthenticates all clinical rule approvals and retirements by a short-lived resource-bound step-up. Stage 122 checks current active referenced catalog records at approval. **Both preserved.**
- Verified P0 issue: Rule `branchId=null` matches multiple branches in existing rule-selection logic, but governance checked only `activeBranchId` and a grant for that branch. Staff with only branch A permission could authorize or retire an organization-wide rule impacting branch B.
- Related flaw: approval of explicitly A-branch-scoped rules did not require the linked test's department to belong to A (a B-department test could pass if active).

## Delivered controls
1. `src/lib/clinical-rule-governance-scope.ts` re-reads all **active** organization branches and actual current operator branch grants, intersected with the authenticated session's original grants. For a branch-specific clinical rule, the effective authorized branch must match the selected active branch and grant. For a rule without an effective branch, the approver must possess coverage over **every active branch**. This prevents one branch from silently issuing organization-wide clinical policy.
2. For organization-wide rules, any present department restrictions require explicit coverage of **every active department**. Current grant records and session grant snapshot must both authorize it. Organization-wide users with zero department restrictions retain the LIS's existing unrestricted-department semantics.
3. Applies identically to `APPROVE` and `RETIRE`; a single-branch approver must not retire a global policy either.
4. Existing live actor role and active session checks remain in place. Scope is evaluated **inside the rule-identity-locked transaction, before** one-time proof consumption, version supersession, rule activation or retirement. Rejected scope returns HTTP 403 without recording a false approval or changing history.
5. Branch-scoped linked test and department references must now belong to the selected active branch (organization-wide rules, already subject to coverage of all active branches/departments, preserve legitimate other-branch references). This prevents branch A approvers authorizing tests assigned only to B.
6. Successful approval/retirement audit includes scope type (`ORGANIZATION` vs `BRANCH`) and number of active branches/departments checked, retaining StepUp grant ID, proof method and all previous auditing.
7. Bilingual interface explains the missing branch/department coverage without disclosing patient data. No test values, clinical thresholds or prices are created.
8. `tests/stage-123-clinical-governance-scope-safety.test.ts` exercises branch-local vs global checks, mismatched branches, session grant additions/revocation, department scope coverage, cross-branch test linkage and governance sequence. `tests/stage-123-clinical-governance-scope-mariadb.integration.test.ts` verifies with real MariaDB two branches, two departments, grant additions and second-connection revocation; rule stays inactive. Both are wired into existing full CI.
9. No Prisma schema or migration changes. Existing Draft #128 and #209 are untouched; Hostinger only.

## Boundaries / follow-ups
- This is authorization coverage **at the time of the governed operation**, not an assertion that medical limits are correct or that every historical rule is safe.
- A future newly added branch is not retroactively associated with an individual user's previous grants; organization-wide clinical policies and enterprise governance for newly added branches require explicit operating procedures and qualified sign-off.
- No automatic deactivation or rewriting of previously approved rules, snapshots, released results or clinical reporting history.
- Manual patient/clinical/device/analyzer UAT and production backup/restore remain deferred until the complete software build, not waived.

## Release gates
- [ ] Exact feature-head CI SUCCESS including Safety, MariaDB, TypeScript, ESLint, AR/EN and Next production build
- [ ] Draft PR ready and expected-head-SHA merge
- [ ] Independent `main` CI SUCCESS on exact merge SHA
- [ ] Owner deploys exact SHA on Hostinger
