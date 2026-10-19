# F2 §87 — All ten native configuration classes can be reviewed safely

**Released baseline:** owner-confirmed Hostinger `d74115933bb24d745be4412883084fb54d8c152e` (PR #332, exact main CI #1836 SUCCESS).

## Verified defect

The signed export/import and ten-class live-drift comparisons exist, but `bundleTriageClass` recognized **only six classes**. The other four native types — `CONTAINER`, `PANEL`, `PACKAGE`, and `PRICE_LIST_PACKAGE_ITEM` — failed drift HMAC observation token creation (`invalid_drift_observation_identity`), and full-batch governance could throw `governance_unknown_entity_type`. This is a real software completeness gap within §87, not a clinical-policy decision.

## Implemented repair and explicitly conservative decision

- **CLINICAL review** for `TEST`, `COMPONENT`, `UNIT`, `CONTAINER`, `REFERENCE_INTERVAL`. Requires session and live `catalog.manage` plus `catalog.reference_ranges.manage` grants.
- **FINANCIAL review** for `PRICE_LIST`, `PRICE_LIST_ITEM`, `PRICE_LIST_PACKAGE_ITEM`. Requires session and live `catalog.manage` plus `pricing.manage`.
- **CROSS_DOMAIN review** for `PANEL` and `PACKAGE`, as their membership may affect the ordered clinical content and commercial composition. Requires both clinical- and finance-management grants in session **and** persisted live authorization to flag or independently review a finding. This is a conservative **metadata-only review permission**, not an approved co-signatory or dual-approval policy.
- Full-batch governance counts cover all ten classes and render the new cross-domain bucket in Arabic/English. No clinical, price or catalog master mutation was introduced.
- Tests cover all native type classifications, signed observation tokens, missing/revoked grants, two distinct reviewer identities, stale evidence, whole-batch governance, unchanged review-only guard and MariaDB synthetic DRAFT tenant-scoped rows. CI runs the new MariaDB test.

## Gate preservation

- Review findings are explicitly **NOT** a signature, regulatory approval, price publication or clinical activation. Existing `CONFIG_BUNDLE_REVIEW` and `CSV_REVIEW` commits stay prohibited.
- This repair does not prove foreign-source mapping, safe application, version/effective-date invariants, independent medical + finance signatories, MFA/e-signature, accepted changes, reversals, replay or export→approved apply→re-export parity.
- These remain **F2 OPEN** and, where owner/qualified external choices are indispensable, `BLOCKED_EXTERNAL`. Do not mark #327 F2 complete, start F3, or conduct owner browser QA before F7.
