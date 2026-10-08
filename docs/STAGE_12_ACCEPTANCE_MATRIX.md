# Stage 12 — Equipment and QC engineering acceptance matrix

**Base:** `main` `7672a290e988fdecc066532db011ad653e757155` (Stage 11 / CI #828).  
**Target:** Master Scope §§53–57 and roadmap Phase 13; no requirement has been removed.  
**Boundary:** Engineering tests are not physical instrument, vendor, calibration or lab-policy acceptance.

| Requirement | Baseline review | Stage 12 work / outstanding acceptance |
|---|---|---|
| Asset register, branch and analyzer ownership | Existing `Equipment` FK/asset registration, branch checks | Existing; check real equipment identifiers at final UAT |
| Maintenance plans, events, performed work, currency | Existing `MaintenancePlan` / `MaintenanceEvent` | QC gate now blocks overdue scheduled and in-progress maintenance; verify full due-date semantics with lab later |
| Calibration results/approval | Existing `CalibrationEvent` and evidence | QC gate blocks unapproved calibration; restore requires approved PASS after recorded calibration |
| Equipment downtime, physical service fitness | Existing downtime create/close had read-before-write races and auto-reactivated | Equipment-row transaction lock, conditional close, explicitly audited RESTORE with open-ticket, calibration and maintenance guards |
| QC materials/lots/expiry | Existing materials/lots and optional inventory-lot links | Re-read lot status within QC entry transaction; physical lot acceptance deferred |
| Effective-dated QC targets, SD/CV, rule settings | Existing `QcTarget` and snapshots | Serialize overlap validation behind analyzer lock; preserve historical results |
| QC run + Westgard decisions | Existing configurable rules, `QcRun`/`QcResult` and rule snapshots | Serialize per-analyzer run entry; re-read targets/lot under lock; same-time committed history visible |
| Levey–Jennings | Existing QC UI to recheck independently | Final laboratory chart verification deferred; no claim of instrument accuracy |
| QC violation corrective-action closure | Existing `QcRuleViolation`, `QcAction`, audit | Atomic OPEN-to-RESOLVED CAS before creating action; losing transaction cannot add a duplicate action |
| Result QC holds / analyzer routing | Existing `resolveAnalyzerQcGate` used in validation | Expanded equipment/maintenance/calibration blocking; further commit-boundary and bridge interplay to audit |
| MariaDB race regression | Existing general integration tests, no focused equipment/QC suite | New two-connection integration for resolution CAS, overlapping targets and equipment locking |
| User interface | Existing bilingual equipment/QC screens | Bilingual guarded RESTORE option; comprehensive manual UAT deferred by owner |

## Explicit safety and delivery gates

- [ ] Focused MariaDB integration and existing safety suite succeed on final exact feature SHA
- [ ] Prisma migrations/status, TypeScript, lint, bilingual UI checks and Next.js production build succeed
- [ ] Review remaining cross-module result-release and AnalyzerWorkOrder lifecycle boundaries
- [ ] Verify final exact feature-branch CI before marking ready / merging
- [ ] Verify exact merge SHA CI on `main` after merge
- [ ] Confirm deployed Hostinger SHA independently; CI alone is not proof
- [ ] **DEFERRED:** all manual UI, barcode, hardware/analyzer, vendor, calibration-physics, clinical QC policy and laboratory acceptance until the full project's acceptance phase (owner decision)

**PR #128:** Separate DRAFT Analyzer Bridge branch remains unmerged; avoid blind cherry-pick or accidental merge. Device-specific protocol and clinical commissioning scope remains in Master Scope.

**Clinical policy note:** Existing QC valid-hours and Westgard selections are configurable; thresholds, override authority, grace periods and lookback need signed laboratory policy before clinical release. Fail-closed safety is preferred to inventing authorizations.
