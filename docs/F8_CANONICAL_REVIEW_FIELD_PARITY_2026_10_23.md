# F8 §87 — Canonical review worksheet fidelity and full intake parity

Baseline main `4d392beedd63b2a854db15c50be51ffa608e8a20` (independent push CI #39984289061 COMPLETED SUCCESS). Master functional scope remains the unchanged 88 sections of `02_MASTER_SCOPE.md`.

## Reproducible software gaps

1. Canonical source-to-DRAFT CSV/XLSX review generation previously used only legacy row validators. The staging endpoint had gained strict DECIMAL(18,4), UTC tariff window and duplicate identity checks in #375, but the export pipeline omitted these checks. A generated “review-ready” file could subsequently become an ERROR at upload, including overflow amounts and duplicated master identities.
2. The normalized CSV/XLSX form of an existing container silently discarded `nameAr`, `tubeColor` and `additive` even though these fields exist in the signed source and database. A unit likewise discarded `ucumCode`. The source bytes were retained for review, but the staged normalized preview lacked key medical master metadata.

## Engineering change

- Extend accepted strict CSV/XLSX review headers for `CONTAINER` and `UNIT`; project `nameAr`, `tubeColor`, `additive` and `ucumCode` from current signed source into explicit canonical DRAFT worksheet columns.
- Preserve those fields in normalized review rows rather than silently dropping them. Enforce stored column size limits (container Arabic name 150, tube color 80, additive 150, UCUM code 50) without claiming UCUM clinical compatibility, substitutions or conversions.
- Reject non-canonical source values which change under review normalization (case, leading/trailing spaces, membership contents or bilingual fields). Catch repeated source immutable IDs independently of repeated destination codes.
- Run the exact staging tariff precision/window and batch identity validators before advertising a “review-ready” export; reject candidates with ERROR, retain WARNINGS as review findings. No automated policy judgment or tariff winner resolution.
- Keep source JSON signed bundle separate as authoritative full-field evidence: a CSV/XLSX worksheet is **not** a full restore/activation format.
- Add synthetic Arabic/UCUM/nullable tests, malformed source/batch identity/precision tests and independent two-session real MariaDB branch/tenant/snapshot consistency regression wired to CI.

## Non-negotiable boundaries

All import submissions remain `CSV_REVIEW`, author-private, checksum-audited and `DRAFT`. Existing commit and revalidate gates continue to reject this source type. Nothing updates live catalog pricing, historic reports, released results, tax policy or source MDB. Actual clinical authorization of tubes/UCUM/analyzers, finance/tax and source-row mapping is BLOCKED_EXTERNAL under §§75/86/88.

§87 **PARTIAL**: this closes two verifiable draft review fidelity defects, but does not deliver complete field-level signed bundle-to-target activation for every entity. Do not mark all 88 Master Scope sections complete. F7 owner private browser 0/486 NOT_EXECUTED, F8 88-case qualified physical UAT 0/88 NOT_EXECUTED, seven independent qualified reviewer approvals absent, **NO_GO**. Public GitHub may contain only synthetic fixtures. Actual Hostinger deployment and hardware/DR are unverified.

Merge discipline: full CI SUCCESS on exact PR head, compare latest branch/PR/CI SHAs, expected_head_sha merge, independent main push CI SUCCESS on the merge SHA. No tests requiring owner manual participation during software development.
