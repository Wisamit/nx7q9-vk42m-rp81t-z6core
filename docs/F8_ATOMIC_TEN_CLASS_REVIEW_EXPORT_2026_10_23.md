# F8 §87 — Atomic ten-class human-review CSV/XLSX export (2026-10-23)

Baseline verified `main=a01b85c9e4adc423da3c1e92639fb07dc70af914`, independent push CI #39993722263 COMPLETED SUCCESS (225/225). The 88 sections of `02_MASTER_SCOPE.md` remain authoritative.

## Verified integrity gap

The existing UI offered a transaction-consistent, same-origin, signed, scoped JSON bundle, but the separate all-fields CSV/XLSX human-review download for each of ten configuration classes independently paged the live export API. A change to patient-independent master configuration while those pages were being retrieved could combine different database revisions into one apparently unified reviewer file. For critical limits, reference intervals, unit definitions and prices, that is unsuitable source evidence. The old CSV correctly disclosed `paged-live-not-atomic` but was still easy to treat as one configuration snapshot.

## Implementation

- All human-review CSV/XLSX **including REFERENCE_INTERVAL** now read the existing protected `/api/catalog/configuration-export/bundle?types=...` endpoint (same organization/branch/department and clinical/finance export grants, signed payload, repeatable-read, source field contract, audit) rather than pagination.
- The new pure `checkedAtomicCatalogReviewSource` rejects old/partial field manifests, missing or duplicate class/row identities, invalid timestamps, wrong order, wrong organization UUID, missing nested structures, and nontransactional source payloads. This is a **client-side shape check**, NOT browser HMAC authentication; the server owns signing. Full current v1 field contract is mandatory and legacy exports are never silently upgraded.
- Source-review CSV writes explicit `transactional-consistent-read` provenance, while retaining compatibility for older intentionally paged CSV callers. XLSX stays literal-text/no formula. All 10 source classes are reviewable; nested component and Arabic/critical-value evidence is preserved in the flattened human worksheet.
- The separate nine-class canonical **re-importable DRAFT** worksheet and its author-only stage, signed source lineage, tenancy and approval barriers remain untouched. The human-review XLSX/CSV, especially REFERENCE_INTERVAL, is NOT directly importable, activatable or a lossless restore. Original signed structured JSON remains authoritative.
- Synthetic source contract tests include all ten classes; exact decimal and Arabic critical limits, native XLSX parity, missing-field/invalid manifest/duplicate UUID rejection, and source/API wiring. Pre-existing MariaDB repeatable-read integration tests exercise the same atomic bundle server boundary.

## Acceptance and external blockers

§87 source-side snapshot consistency for reviewer worksheets improved; complete controlled field-level migration/activation is still **PARTIAL** and MUST use existing F2 independent governed clinical+finance approval/application, never browser-side writes. No clinical thresholds, mappings, tax rules or tariffs are inferred.

§75 analyzer sample-interference clinical policy, §86 jurisdictional financial/tax policy, §88 original MDB source row parity and expert signoff are still BLOCKED_EXTERNAL. Public-repo protected F7 browser 0/486 NOT_EXECUTED; F8 88 qualified human/device/accounting/Hostinger UAT cases NOT_EXECUTED and seven external signoffs missing. **NO_GO.** Do not claim hardware commissioning, Hostinger deployment or restore evidence from CI.

Required exact-SHA merge gate: feature full CI SUCCESS, PR head comparison, `expected_head_sha` merge, independent main push CI SUCCESS on actual merged SHA.
