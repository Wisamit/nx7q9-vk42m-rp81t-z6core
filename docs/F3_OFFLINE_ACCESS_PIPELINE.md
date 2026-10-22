# F3 / §88 — Offline Access extraction → hashed lineage → scoped reconciliation

## Development status

This is a **software workflow for synthetic data and future privately authorized
Access source material**. It does NOT depend on an operating laboratory or
appointed clinicians/finance staff. No original MDB was used to build these
features. Production patient/result content is never a permitted input.

## Data flow

1. **Read-only Windows ACE step:** `scripts/f3-access-ace-extract.ps1`
   accepts an explicit JSON manifest with `tables` (a list of objects each
   having an exact `name` and `columns` array). It selects only approved
   table+column combinations using forward-only read-only ADO access.
   The source MDB file is SHA-256 hashed before and after extraction; a
   modified file is rejected. The output includes raw CONFIGURATION cells,
   so it must remain on a protected, private machine and MUST NOT be
   attached to support tickets or checked into Git.
2. **Offline HMAC conversion:** `npm run f3:offline-intake -- --input
   <private-extract.json> --output <hash-only-pages.json>
   --organization-id <UUID>` using a deployment-managed
   `F3_LEGACY_HMAC_SECRET` of at least 32 UTF-8 bytes. The output is
   created exclusively with 0600 file permissions and contains only
   deidentified row HMACs, schema/source SHA identifiers, occurrence
   ordinals, per-table counts and 500-row review-only pages. The
   conversion refuses an existing output file or a missing signing key.
3. **Persist bounded review-only fingerprints:** Each element of
   `pages[]` uses the exact existing
   `POST /api/catalog/legacy-row-lineage` source manifest schema.
   The operator workflow must submit them through an authenticated,
   organization-wide scoped session. This records row identities only,
   not raw test values, not clinical/financial approval and not master
   activation. No automatic upload occurs in the CLI.
4. **Reconcile:** Submit the `manifest` field (NOT raw extract or
   `pages[]`) to
   `POST /api/catalog/legacy-row-lineage/reconcile`.
   The server rechecks original/current catalog, clinical and financial
   permissions, full organization/branch scope and no department
   restriction. In a single locked transaction it loads current lineage
   from MariaDB and checks target IDs belong to the organization.
   Returned counts indicate missing, ambiguous, duplicate and
   many-to-one mappings. The response never includes HMAC values, raw
   source cells or target UUIDs.

## Configuration-only Access table allowlist

`Test name`, `test`, `profile`, `normal`, `price`, `Unites`,
`Tube`, `Tubes`, `Comment`, `ORGANISM`, `Antibiotic`, `Fungi`,
`Referdby`, `Source`, `Gropes`. These are linked to the existing
`LEGACY_COVERAGE_SOURCES` / `legacyRowTargets` contracts, which define
which target classes may be used for each source table.

Known patient, result, microbiology report and specialist result tables
(including `password`, `result`, `culture`, `cbc`, `urine`, `thyroid`
etc.) are excluded. This 15-table list is the **configuration-data
scope**, not a claim that every clinically useful feature has been
extracted from a real MDB. Later operational extraction may be designed
under separately approved, privacy-preserving scopes.

## Safety and completion semantics

- No one should paste secrets into command-line arguments. The CLI reads
  the HMAC signing key from its local environment and does not print it.
- Original Access row order is not guaranteed. Per-keyed-digest occurrence
  numbers prevent duplicate source rows from collapsing silently.
- Decimal and datetime values are preserved as source text; Access
  timezone-naive timestamps are not silently converted to UTC.
- Correct original-source identity still requires later independent
  provenance verification. A local file SHA alone is not an authorized
  source installation certificate.
- The `syntheticFullyClassified` flag means *only* that the bounded
  synthetic, 15-table digest set has complete non-ambiguous classifications.
  It is **not** approval to activate a catalog, tariff, reference interval
  or released report.
- Real MDB row-level reconciliation, clinical/finance signoff and
  production GO are deferred until F8, after F3–F6 code completion and
  F7 owner browser review.

## Engineering proof

The CI validates TypeScript, ESLint and safety tests for the offline
CLI, HMAC/duplicate mapping, digest-only endpoint, authoritative
15-table allowlist, current target checks and a real MariaDB lineage
reconciliation test. F3 remains in progress until full synthetic
conversion-to-staging and source/target parity are evidenced; CI
passing alone does not represent operational data migration.


## F3 synthetic software acceptance checklist (2026-10-22)

| Software requirement | Evidence | Status |
| --- | --- | --- |
| Preserve integrated F2 ten-class exports and effective revisions | F3 merge has F2 main as an additional Git parent; comparison against `main` shows zero commits behind | Implemented |
| Read-only ACE extract for 15 configuration tables, no patient/result/password import | `scripts/f3-access-ace-extract.ps1`, allowlist/denial tests, SHA pre/post; both `.mdb` and `.accdb` accepted by extractor and offline intake | Implemented, synthetic inspection only |
| Local HMAC conversion without leaking source cells | `scripts/f3-offline-intake.ts`, `f3BuildLegacyReviewPages`, exclusive 0600 output and CLI regression | Implemented |
| Strict manifest before tenant lock/SQL | `parseF3UnverifiedDigestManifest` now checks per-table counts, schema binding, duplicate counts, unique and contiguous HMAC occurrences, total-row equality; `tests/f3-digest-ingress-parity.test.ts` | Implemented |
| Same 500-row, 15-table staged lineage protocol | `parseLegacyRowManifest`, `tests/f3-legacy-intake-pages.test.ts` | Implemented |
| Offline synthetic evidence to actual MariaDB lineage and scoped target reconciliation | `tests/f3-legacy-lineage-mariadb.integration.test.ts` constructs same private ACE-style extract and 15 HMAC-only staged pages, then checks real SQL ledger, tenant isolation, stale target rejection, and missing-row result | Implemented for synthetic evidence |
| Approved real MDB source custody, row-by-row authentic mapping, medical and finance signatures | Need original installation evidence, qualified independent signers and effective-dated policy at F8 | BLOCKED_EXTERNAL; never simulated as operational GO |
| F7 owner browser and actual Windows ACE execution on owner environment | Intentionally deferred until after F6 software completion | DEFERRED |

This is a **software-only** reconciliation boundary. A passing synthetic manifest or the name
`APPROVED_MAPPING` on fixture rows must never be read as qualified clinical/financial authorization.
No test data, patient data, report, catalog price or reference range is activated by the F3 reconciliation API.
The synthetic CI checks do not assert an original Access installation was independently observed,
nor do they substitute for owner UAT or device/financial policies.
