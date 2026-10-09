# Stage 36 — Advisory Staged CSV Age-Window Intersection Review

**Base:** Stage 35 `main` `d60069bb372896ce94b3c06d40ca280048942475`, CI #920 completed SUCCESS. The latest owner-confirmed Hostinger deployment at handoff was Stage 34; Stage 35 deployment remains unconfirmed.

## Source audit / gap

Stage 35 compares exact staged test/unit/sex/age context across a bounded CSV batch. It detects identical and contradictory limits only when **both age endpoints are the same**. Two distinct but intersecting staged age intervals can otherwise remain invisible to a reviewer across pagination boundaries.

## Implemented

- `stagedRangeAgeOverlapIndex` reviews eligible `VALID/WARNING` `REFERENCE_INTERVAL` rows from the **same already-authorized batch**, up to the existing 20,000 candidate bound, across all CSV pages. It compares only exact normalized source test, result unit, sex and age-unit text.
- Compares only **both explicitly supplied, valid, non-negative decimal age boundaries within the same age unit** using scaled `BigInt`, never JS floating-point. Reversed or incomplete bounds are excluded from this advisory comparator.
- Deduplicates identical source age windows before searching for intersections. Distinct intersecting windows (including shared endpoints, whose clinical inclusivity is unknown) emit `POTENTIAL_STAGED_AGE_WINDOW_OVERLAP`. Unique-window sorting plus prefix maximum-end / next start gives O(N log N) review rather than quadratic all-pairs comparisons.
- The scoped uploader-gated read-only range reconciliation endpoint surfaces this advisory for resolved `REVIEW_REQUIRED` rows, preserving Stage 35 exact-context issues and existing `BLOCKED` redaction behavior.
- Audit contains **count only**, not staged source values; no live reference-interval writes, report changes, approval, activation, schema migration or financial changes.
- Adds safety tests and a two-independent-session MariaDB fixture verifying same-batch cross-page overlap, cross-tenant isolation, and unchanged staged records. The MariaDB test is explicitly part of `.github/workflows/ci.yml`.

## Deferred, not waived

- This advisory is **not a clinical interval-overlap adjudicator**. It never equates `ANY` to `MALE/FEMALE`, age units, test aliases, equivalent result units, pregnancy/population contexts, methods, specimens, analyzers, branches or effective dates. Touching endpoints may or may not clinically overlap according to approved boundary policy; the indicator is intentionally conservative.
- No automatic clinical approval, write, overwrite, component mapping or bulk import. Clinically governed imports still need approved reviewers, effective-date/version/overlap policy, method/specimen/branch/analyzer provenance, audit and safe transactional commit.
- Canonical review CSV remains distinct from Stage 27 human review export. `.xlsx`, other configuration entities and MDB transformation remain in full Master Scope.
- All 88 Master Scope sections remain binding. Analyzer Bridge PR #128 remains separate Draft/unmerged and must not be automatically merged.
- User-requested manual clinical, analyzer, scanner/printer and end-to-end UAT stays **DEFERRED**, not passed. GitHub CI cannot verify production Hostinger deployment or operational acceptance.
