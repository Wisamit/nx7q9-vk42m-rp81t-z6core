# F8 §88 — Source-table completeness and cross-table target reuse reconciliation

**Base:** `main=6324b7c8344da0626cf7abd81c317c37d56c3506` after merged PR #384 and independent main CI #40061677715 completed SUCCESS.

## Confirmed software gaps

The **private, read-only, metadata-only** legacy row lineage reconciliation accepted an otherwise fully assigned 2-table source extraction as `ROW_KEYS_MATCH_REVIEW_ONLY`, even though 13 of the 15 expected Access catalog source tables were explicitly reported `present:false`. Each table correctly disclosed `ABSENT_SOURCE_TABLE`, but the top-level state was easier to misunderstand as a complete reconciliation.

Furthermore, repeated mapped target identities were detected only within **one** source table. A `TEST` target referenced by two distinct original Access tables, such as `Test name` and `test`, was not detected at the aggregate level, even though both distinct original HMAC row identities must be independently resolved and reviewed.

## Implementation

- Make overall status `GAPS_REMAIN` whenever *any* of the 15 expected catalog reference source tables are absent. A table that was observed but legitimately has zero rows stays `SOURCE_EMPTY`, not automatically missing. Only all 15 present with complete individually resolved HMAC keys and no mapping/reuse gaps can reach `ROW_KEYS_MATCH_REVIEW_ONLY`.
- Track mapped target reuse globally across all 15 Access tables (target entity class + immutable target UUID); retain existing per-table reuse finding on the later/duplicate assignment. Count additional references `N-1`, never double-count a pair. This is a qualified review finding, **not** a prohibition on a medically approved alias or evidence of clinical equivalence.
- Preserve strict source SHA, HMAC digest key ID, table schema, duplicate occurrence identity, tenant scopes, 15-table whitelist, payload privacy, source-data absence, and existing independent source/reviewer gates.
- Extend synthetic regression fixtures to cover partial 15-table source with all observed rows approved, all-15 observed with empty-but-present tables (review-only), and distinct `Test name`/`test` HMAC rows incorrectly sharing one `TEST` target. Assert no target UUID or source HMAC is exposed in report output.
- No database writes, migrations, patient rows, prices, unit/range changes, or activation. Original cleaned MDB provenance remains an independent private Windows/ACE/evidence/signature task.

## Original 88-section scope and external acceptance

This increment addresses a **software reporting ambiguity**, not proof that the original MDB/ACCDB was opened, that its raw values agree, or that the mapped target records are clinically/financially correct. §88 remains `BLOCKED_EXTERNAL` until independent original file provenance, source-row and value reconciliation, qualified clinical/finance signoffs. §§75/86/87 remaining policy/activation gates unchanged.

F7 protected browser 0/486 NOT_EXECUTED; F8 qualified real-world UAT 0/88 NOT_EXECUTED; seven qualified independent signatures absent. **NO_GO**. Hostinger deployed merge SHA, device commissioning and real DR restore not asserted by CI.

**Release gate:** full CI COMPLETED SUCCESS at exact feature HEAD → compare PR SHA → merge with `expected_head_sha` → independent main push CI COMPLETED SUCCESS on actual merge SHA.
