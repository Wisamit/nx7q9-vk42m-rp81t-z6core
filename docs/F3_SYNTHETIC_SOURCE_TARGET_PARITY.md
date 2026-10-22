# F3 — Private Access-to-LIS row-identity parity (§88)

Status: **ENGINEERING IN_PROGRESS**. The owner will supply real source/qualified acceptance after software completion. No new clinical, patient, order, price or microbiology master writes. This is an exact *HMAC row-key reconciliation*, not proof that mapped clinical values agree.

## Existing extraction and replay (unchanged)
- The existing Windows ACE local scripts `export-source-coverage.ps1`, `export-row-lineage.ps1` and `verify-access-row-replay.ps1` cover the 15 allowlisted configuration tables defined in `LEGACY_COVERAGE_SOURCES`. Patient/order/result values remain private.
- `verify-evidence-package.mjs` checks the original local Jet file bytes against source coverage and complete HMAC manifest page identity, and optionally replays ACE with the same key. This is not an independent certification.
- A real Windows ACE run remains **NOT_EXECUTED** in Linux CI. Never invent extracted table rows, value comparisons or professional signoffs.

## New private target lineage export
On the operator's private workstation (NOT in CI, GitHub or public Hostinger), use an environment-provided **read-only MariaDB account** with access only to the organization's lineage and identity records. The following commands operate locally after the Windows ACE source/HMAC tools have created the coverage and private pages:

```powershell
$env:DATABASE_URL = "mysql://READ_ONLY_ACCOUNT:PRIVATE_PASSWORD@HOST:3306/DB"
node --experimental-strip-types scripts/legacy/export-target-lineage.mjs --organization YOUR_ORGANIZATION_UUID --source-sha256 SOURCE_SHA256 --output "C:\private\target-lineage.json"
node --experimental-strip-types scripts/legacy/verify-target-reconciliation.mjs --mdb "C:\private\Family lab -test.mdb" --coverage "C:\private\coverage.json" --lineage-dir "C:\private\lineage" --target-export "C:\private\target-lineage.json" --organization YOUR_ORGANIZATION_UUID
```

Use an output path that does not already exist. The exporter opens an immutable `REPEATABLE READ` read-only SQL transaction and pages only the selected organization's `legacy_catalog_row_lineage` records for one exact source hash. No source row values or demographic fields are selected. The exported JSON **does contain private HMAC digests and mapped UUIDs**, and must never enter a repository, browser, email or artifact bucket. POSIX file creation uses exclusive `0600`; on Windows, restrict the private directory with appropriate NTFS ACLs. Do not put connection secrets into command arguments or shell history. Delete the private JSON according to the operator's retention policy after the reviewed evidence is secured.

## Exact reconciliation
The new `reconcileF3LegacyTargets` checks:

1. All **15 configured source tables** and their schema hashes, source SHA-256, file byte length, HMAC key identifier, page count and ordered digest occurrence sequences against the existing strict evidence-package verifier.
2. Full multiset equality of each source key `(tableName,rowDigest,occurrence)` against the corresponding organization/source/schema/key constrained target lineage record. Same-content rows remain distinct via occurrence numbers; no table-to-table substitutions.
3. An absent target record becomes an explicit gap. A target record not present in the source, duplicate key, wrong source, wrong schema/key, illegal table-target mapping or malformed extra field **fails closed**.
4. Distinct totals by table: `UNRESOLVED`, `AMBIGUOUS`, `NOT_IMPORTED`, `MAPPED`, `APPROVED_MAPPING` and reused target IDs. A numeric count match or `APPROVED_MAPPING` state alone never certifies source-to-target clinical/financial value parity.

The normal CLI result has only aggregate counts and categorical findings, **no row HMACs or UUIDs**. Exit codes: `0` means row keys are consistent but **NOT CERTIFIED**, `3` means reconciliation gaps remain, `1` means malformed/tampered/private evidence was rejected and `2` means incorrect usage.

## Boundaries and remaining F3 coding
- A private target JSON is **not independently authenticated database provenance**; the operator should use the scoped, read-only query and retain DB/query attestation if official traceability is required.
- The existing two tools prove row *identity accounting* only. Subsequent F3 work must still join source-derived field-specific normalization and imported target master snapshots (price/interval version, profile membership, organism/antibiotic/comment/referrer) to reconcile **semantic values**, while preserving historical releases, branch scope and protected values.
- Synthetic Jet fixtures and private CLI regressions validate implementation without any real patient data. Operational real ACE extraction, independent clinical/finance confirmation, UAT and cutover remain F8.
- F2 code and F3 changes are on separate draft PRs. No merge or Hostinger deploy is claimed by this milestone.
