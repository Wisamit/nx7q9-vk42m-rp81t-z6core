# Legacy Family Lab Catalog Migration Mapping

## Purpose
The cleaned Access MDB is a configuration and workflow source, not a schema to reproduce. Import must pass through staging, validation, review and audit before creating production catalog records.

## Source-to-target mapping
| Legacy source | Meaning | Target domain |
| --- | --- | --- |
| `Test name` | Test catalog: abbreviation, panel, name, unit, assay, collection | `LabTest` + mapped `Unit` / `Method` / specimen instructions |
| `test` | Abbreviation/name lookup | Catalog reconciliation / aliases; never blindly create duplicates |
| `profile` | Profile names | `TestPanel` |
| `normal` | Generic age/sex/unit ranges | `TestComponent` + `ReferenceInterval` |
| specialized `*n` tables | Specialty component ranges | Generic components + reference intervals |
| `Unites` | Units | `Unit`; UCUM mapping remains reviewable |
| `Tube` / `Tubes` | Tube/container configuration | `Container` |
| `price` | Price by source | Billing price-list migration in Phase 4, not current catalog tables |
| `Comment` and specialty comment tables | Predefined result/report comments | Controlled comment/template master data |
| `ORGANISM`, `Antibiotic`, `Fungi` | Microbiology dictionaries | Phase 9 microbiology master data |
| `Referdby`, `Source` | Referrers/sources | Phase 3 client/referrer master data |

## Import safety rules
1. Never import directly from the MDB into live catalog tables.
2. Preserve the original row as JSON in `CatalogImportRow.sourceData`.
3. Store normalized candidate values separately in `normalizedData`.
4. Duplicate/ambiguous mappings are warnings or errors, not silent merges.
5. Tests, units, profiles and ranges require organization-scoped duplicate checks.
6. Reference intervals retain sex, age-from, age-to and age-unit semantics from the legacy system.
7. Unknown or ambiguous units are not auto-assigned a UCUM code.
8. Prices are staged for Billing; they are not collapsed into `LabTest`.
9. Specialized legacy result/range tables are translated into generic tests/components/ranges rather than recreated as specialty tables.
10. Each validated/imported batch creates audit events and retains its checksum/source name for provenance.

## Controlled sequence
`Extract -> Stage -> Normalize -> Validate -> Human review of warnings -> Import transaction -> Audit -> Reconcile counts`.

## Initial entity types
- TEST
- PANEL
- UNIT
- CONTAINER
- REFERENCE_INTERVAL
- COMMENT
- PRICE
- REFERRER
- ORGANISM
- ANTIBIOTIC

The first executable importer should target TEST / PANEL / UNIT / CONTAINER / REFERENCE_INTERVAL. Other entity types remain staged until their target modules exist.
