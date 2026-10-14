# Stage 118 — Legacy Access MDB Source Coverage and Safe Reconciliation

## Verified Stage 117 baseline
- Base `main`: `428ab4f526584e1231653a14b74003431ee7a65b` (Stage 117 merged PR #241, independent main CI #1250 SUCCESS and owner-confirmed Hostinger publish).
- Master Scope §§7–11, 17, 34–35, 37, 41, 63, 79–80, 87–88.
- Stage 104 already has an operator-visible catalog import **staging ledger**, not source coverage. Stage 105 already has specialty reference-range source-evidence review. Stages 82–84 support separate reviewed direct CSV dictionary/client/comment imports. Stage 117 supports nine-class native JSON review, not clinical/financial activation.
- The attached cleaned `Family lab -test.mdb` has an owner-supplied copy hash `318814ed8bfc086e0ea5df467c55a2aa0a85a5edf96e962c06d1d5b5a9889eed`, but **the production server does not have permission to read this file**. A source SHA carried in an uploaded manifest is a *claim*, not independent on-server authentication.

## Delivered
1. Windows-only `scripts/legacy/export-source-coverage.ps1` uses a read-only Microsoft ACE/Jet OLE DB connection to inspect an explicit allowlist of **15 known safe master/dictionary tables**, and ONLY extract table presence, physical row counts, column counts and a SHA-256 of column/schema metadata; the original MDB SHA-256, length and local export time accompany it. No clinical values, patient/order/result/payment records, names/notes or free text are exported. Explicit missing table records, no partial output, before/after source-file hash, atomic write.
2. `src/lib/legacy-source-coverage.ts` enforces exact deidentified source type, source identifier, full allowlist, unique tables, integers, schema digests and privacy flag. Builds explicit table-to-target coverage status, never converting numerical similarity to row mapping, clinician signature or financial sign-off.
3. `POST /api/catalog/legacy-source-coverage`: bounded streamed JSON (64 KiB), active staff with `catalog.manage`, `pricing.manage`, `catalog.reference_ranges.manage`, active authorized branch, and **organization-wide unrestricted department scope**. Under tenant lock and Serializable transaction, checks live role grants, branch and department scoping. Reads only up to 100 **possible** same-source-name `LEGACY_MDB_EXPORT` batches authored by this operator, re-groups source candidates by entity/status and safely audits summarized evidence. Other tenants', authors' and mismatched-name batches cannot influence counts. No patient or configuration master reads/writes.
4. Bilingual `src/components/legacy-source-coverage-review.tsx` in the existing `/catalog/imports/reconciliation-ledger` shows counts by Access table, mapped target category, potential staged/imported/unresolved records and explicit review reasons. All results retain `sourceIndependentlyVerified:false`, `rowParityCertified:false`, `clinicalApproved:false`, `financialApproved:false` and `cutoverApproved:false`.
5. `tests/stage-118-legacy-source-coverage-safety.test.ts`: policy/manifest rejection and non-certification tests. `tests/stage-118-legacy-source-coverage-mariadb.integration.test.ts`: synthetic real MariaDB tenant/author/name scoping, mixed staged statuses and two-connection transaction rollback; wired into existing CI.
6. No Prisma migration, price activation, reference interval writes, legacy password import, historical patient data conversion or change to existing clinical/financial snapshots. The two existing unrelated Draft PRs #128 and #209 remain untouched.

## Source extraction (not an acceptance action requested during development)
On a **local Windows workstation** with an Access ACE provider installed:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\legacy\export-source-coverage.ps1 `
  -MdbPath "C:\private\Family lab -test.mdb" `
  -OutputPath "C:\private\family-lab-legacy-source-coverage.json"
```

The JSON contains no Access data row values, but may reveal inventory sizes and a database fingerprint; keep it private. Upload only to an authorized LIS review UI over HTTPS after completing software development. **Do not upload the MDB to the public GitHub repository or attach it to a public issue/PR.**

## Definite limits / next closure requirements
- **A matching count is not source-record parity.** The existing staged JSON checksum is different from the MDB file checksum. Without a signed row identity lineage, the server cannot prove that each source row was represented correctly, nor that a review-only bundle produced a live approved target.
- Direct CSV imports for referrers, sources, organisms, antibiotics and comment templates do not all create `CatalogImportBatch` entries; Stage 118 reports them as `DIRECT_IMPORT_REQUIRES_PROVENANCE`, not missing features. The table `test` aliases and `Gropes` need manual mapping. Missing source table names are surfaced, not inferred.
- The 15-table inventory is not a certification of all Access tables or the specialty `*n` tables (which retain the separate Stage 105 evidence workflow). A future **private source-row mapping/lineage** approach would be necessary for complete §88 cutover and exact parity.
- ACE runtime and actual MDB source-table enumeration cannot be executed in Linux GitHub CI. The attached MDB has been identified and hashed but **actual 15-table count output is not certified**. Clinical/financial approvals, manual UAT and real database backup/restore remain deferred.
- No new test name, price, method, unit, demographic interval or specialist template is guessed.
- Do not claim Stage 118 alone "completes migration" — it closes a previously absent **coverage-evidence gate** and inventories the remaining migration verification work.

## Release checklist
- [ ] feature SHA full CI SUCCESS
- [ ] PR Ready and expected HEAD SHA merge
- [ ] independent main merge SHA CI SUCCESS
- [ ] owner Hostinger deployment confirmation
