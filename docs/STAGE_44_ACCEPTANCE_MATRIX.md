# Stage 44 — Safe-Master Unit Provenance and Clinical Definition Reuse

**Starting point:** owner-confirmed Hostinger deployment `4618afc8`, Stage 43 PR #163 merged, exact-main CI #940 SUCCESS. Repository verified public before creating this branch.

## Reviewed Master Scope risk

Master Scope §§7–8, 11, 40–41, 80, 87–88 require reliable configuration-driven clinical identities, units, panel composition, immutable historical reports and auditable legacy migration. Stage 43 addressed nonunique **test display names** in panel links. A separate source-level risk remained: the safe-master import built a `Map` from every existing organization's UNIT code and symbol to the last enumerated ID. Two units with an identical symbol or intersecting code/symbol could make a TEST silently bind to an arbitrary unit. A nonempty, unresolvable unit was previously imported as `defaultUnitId: null`. Existing TEST reuse for PANEL membership checked only matching code and English display name, without checking unit, assay or collection context.

## Implemented, conservative behavior

- New `src/lib/catalog-safe-master-units.ts` maintains a conflict-sticky, normalized `code/symbol -> id|null` map. Ambiguous aliases never resolve, independent of database enumeration order. UNIT lookups remain organization-scoped and the transaction includes newly created units.
- Tests with a specified but unknown/ambiguous unit become `SKIPPED` with `UNKNOWN_OR_AMBIGUOUS_TEST_UNIT`, rather than silently receiving a null unit or an arbitrary unit ID. A source with no unit remains explicitly null. Rejected test rows cannot create panel links (existing Stage 43 source-row eligibility).
- Reusing an existing TEST in a panel additionally requires ACTIVE status, identical resolved default-unit ID, assay and collection instructions, compatible default clinical workflow/result type, and no unmatched method/specimen/container context. A same-code/same-name but clinically different test is skipped; no old clinical master is modified. Safe reuse is *not* approval to overwrite the existing catalog.
- UNIT/CONTAINER/TEST/PANEL codes and labels must fit their actual Prisma DB column limits. Reject rather than silently truncate identity strings. Existing panel aliases and Stage 43 collision safety remain.
- No migration. No approved reference range, new pricing approval, released report, order, specimen, analyzer or financial transaction changed.

## Automated verification

- `tests/stage-44-safe-master-unit-provenance.test.ts`: alias conflicts under reversed registration order; same-code test clinical definition mismatches and inactive states; identity length limits; route integration contracts.
- `tests/stage-44-safe-master-unit-provenance-mariadb.integration.test.ts`: two independent MariaDB connections, two organization tenants, colliding unit symbols and different immutable unit IDs, same-name test with differing unit/assay, checked row isolation, correctly resolved default-unit FK, committed panel membership and competing one-winner batch claim. This is a database-backed helper/workflow fixture, not an authenticated HTTP test.
- New MariaDB suite wired into `.github/workflows/ci.yml`. Full existing safety, clinical, billing, database, lint, TypeScript, UI and Next production-build gates must pass on exact final feature and merged-main SHAs before engineering acceptance.

## Deliberate boundaries and deferred acceptance

This is a targeted import-safety increment, **not** final approval of historical legacy mapping, reference interval activation, global clinical configuration import or full MDB migration coverage. Clinically governed recovery of previously ambiguous imports requires separate review; this change does not retroactively rewrite existing clinical catalog links. Any incompatible source row remains reviewable for authorized manual remediation. The full 88-section `02_MASTER_SCOPE.md` is unchanged. Separate Analyzer Bridge PR #128 remains Draft/unmerged.

**Manual clinical/UAT, scanner/printer/analyzer testing, finance and laboratory acceptance: DEFERRED until the complete system implementation.** GitHub success does not establish Hostinger deployment or clinical go-live validation; owner independently confirms the new deployed SHA.
