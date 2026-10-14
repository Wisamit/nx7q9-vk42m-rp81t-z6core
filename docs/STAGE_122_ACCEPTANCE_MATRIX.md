# Stage 122 — Clinical Rule Approval: Live Linked-Master Integrity

## Verified base and gap
- Start from deployed Stage 121 main SHA `27b10941949a93e18bbe032f16ed81a3aa35c8a1` (main CI #1264 SUCCESS; owner-confirmed Hostinger publish).
- Master scope: clinical rule governance, configured test catalog, multi-branch/department permissions, versioned history and audit (§§2, 7–11, 38–41, 63, 75, 79–80).
- Stage 120 already added mandatory resource-bound one-time password/TOTP staff step-up and transactional ruleset identity locks; Stage 121 already secured DECIMAL thresholds. Both remain intact.
- **New verified gap:** Approval only revalidated calculated expression names and version windows. It did not recheck live status/tenancy of referenced tests, components, departments, methods and branches for all seven rules. A draft created before a linked master was deactivated might still become ACTIVE.

## Delivered
1. `src/lib/clinical-rule-approval-references.ts` checks all seven classes just before live approval:
   - `CALCULATED_RESULT_RULE`: test, target component, active numeric target and active department.
   - `REFLEX_RULE`: source/target test identity, active source component, numeric/text threshold compatibility, organization and branch.
   - `DELTA_RULE`: test/component numeric status, nonempty configured limits, active analysis method and branch.
   - `AUTOVERIFICATION_POLICY`, `VALIDATION_HOLD_RULE`, `CRITICAL_ESCALATION_POLICY`: active referenced test and branch.
   - `RESULT_VALIDATION_POLICY`: consistent organization/department/test scope shape, active department/test and corresponding branch.
2. Current department grants are re-read under the authenticated operator; a revoked session department grant cannot silently turn into unrestricted access. Inactive/foreign departments and their parent branches cannot be used for active-rule authorization.
3. Existing calculated-formula compiler remains authoritative for source identifiers, prevention of chaining and formula validation. It now checks that the active target is numeric and formula inputs have the numeric result type and are not the target itself. No duplicate expression parser.
4. Governance checks references *after* the existing identity lock and *before* consuming one-time step-up evidence, closing predecessors or marking a rule ACTIVE. The approval transaction uses Serializable isolation. Any failure returns an explicit non-success error and no master/history edits or signed approval.
5. Approved audit evidence records `approvalReferencesRevalidated: true`, retaining proof metadata, version succession and unchanged historical result/report/invoice snapshots.
6. Bilingual approval UI explains that inactive/mismatched referenced records need a corrected draft. This stage never silently repairs old drafts, fills medical intervals, creates reflex orders or activates a policy.
7. Safety unit tests exercise all seven rule classes with stale/foreign/mismatched synthetic links, branch/dept removal, and approval sequencing. Real MariaDB test creates inactive drafts and changes linked test/component/method/branch state to prove rejection and unchanged rule status. Full CI invokes this test.

## Non-goals / deliberate safeguards
- No Prisma migration or destructive edit. Never retroactively overwrite released clinical results, report versions, signed audit or historical pricing.
- Stale/invalid pre-existing approved rules are not automatically changed. They require a separately governed clinical review and amendment.
- This gate proves linkage/state consistency **at transaction-time approval**, not clinical suitability of any reference values or thresholds. Qualified laboratory review, device/analyzer connectivity, browser/manual UAT and disaster-recovery exercises remain deferred until end of development, not removed.
- Draft PR #128 Analyzer Bridge and #209 interpretations remain OPEN and untouched; Vercel is not used. Owner deploys on Hostinger only after both feature and independent main CI pass.

## Release gates
- [ ] Feature HEAD CI SUCCESS including Safety/MariaDB/TypeScript/ESLint/AR-EN/Next build
- [ ] Draft PR Ready → merge with exact expected SHA
- [ ] Independent main CI SUCCESS on exact merge SHA
- [ ] Owner confirms Hostinger release
