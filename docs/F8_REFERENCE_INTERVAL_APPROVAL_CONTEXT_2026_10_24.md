# F8 §§75/87 — Live clinical context recheck at reference approval (2026-10-24)

**Baseline:** main `97dc9e9788975d273af78fa3462e617e4926ccfd` after PR #389 and independent push CI #40090109366 SUCCESS. Master Scope original 88 sections are unchanged.

## Confirmed clinical safety bug

`POST /api/catalog/reference-intervals` checked ACTIVE Method, SpecimenType and Analyzer under the organization lock before inserting an INACTIVE/DRAFT interval. The later `PATCH APPROVE` re-locked organization, role grants, branches, target interval and active component, but **did not revalidate** optional method, specimen type or analyzer referenced in the staged interval. An operator could approve a clinical rule after its analytic method, specimen identity or branch device was deactivated. The handler also allowed an organization-wide reference interval linked to a physical analyzer with a single owning branch; this was not a valid organization-independent analyzer context.

## Bounded remedy

- `APPROVE` re-locks every optional clinical reference (Method, SpecimenType, Analyzer) using the *existing* tenant/ACTIVE/branch SQL `FOR UPDATE` authority helper under the exact same organization-scoped transaction, BEFORE searching approved intervals, predecessor closure, publication or audit.
- An analyzer-scoped interval must explicitly name the analyzer's own branch. An organization-wide interval with no analyzer remains valid; an analyzer-specific organization-wide interval fails closed on both draft creation and later approval.
- No existing APPROVED interval is deleted or retroactively changed. RETIRE of historical published rules remains separately authorized and does not require currently-active method/vendor context.
- Add pure negative regression (inactive/stale method/specimen/analyzer, missing branch or wrong branch) and a two-connection MariaDB test proving that deactivation before approval blocks a stale DRAFT, while a row locked for approval cannot be concurrently deactivated.
- Keep exact 18,6 decimal values, clinical approval conflict planner, effective-date versioning, independent live actor grants, per-branch scoping and append-only clinical audit. Do not infer vendor policy, clinical cutoffs or laboratory signatory approval from this software correction.

## External acceptance

§75 signed clinical/vendor sample-interference, analyzer/profile and rule SOP policies remain BLOCKED_EXTERNAL. §87 full configuration approval and source mapping parity remain PARTIAL and separate from this reference-specific endpoint. §86 accountancy and §88 original Access migration signoff still require independent qualified evidence.

F7 protected browser `0/486` and F8 88 qualified real-world UAT cases `0/88`; seven independent signatures absent, **NO_GO**. No fresh Hostinger deploy, instrument commissioning or disaster-recovery validation asserted.

**Release discipline:** exact branch-head CI COMPLETED SUCCESS; SHA-matched PR; `expected_head_sha` merge; independently checked main push CI COMPLETED SUCCESS on merged SHA.
