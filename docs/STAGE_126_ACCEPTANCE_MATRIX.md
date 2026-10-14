# Stage 126 — Catalog, Composite Imports and Legacy Access Row Lineage

## Baseline / scope
- Verified `main` 36fdc0a196633586ee84e4cbd4ce85714c60b9bd, CI #1277 SUCCESS.
- Master Scope §§5–8, 11, 17, 87–88; specialty §§34/37 are related review requirements.
- Reuse Stage 117 nine-class JSON review, Stage 118 fifteen-table Access metadata inventory, Stage 119 scoped specialty table review, Stage 104 import ledger, existing normalized catalog and pricing/range models. **No tables per test**.
- Draft PRs #128 and #209 remain unmerged/untouched. Hostinger is operated by the owner.

## Delivered in this branch — verify by exact-HEAD CI
1. `LegacyCatalogRowLineage` + MariaDB migration: a tenant-bound immutable source SHA, Access table/schema SHA, keyed HMAC row digest + duplicate occurrence, digest-key fingerprint, and an optional exact staging/import row + target row binding. Enforces composite source uniqueness and an import-row uniqueness constraint.
2. Strict content-limited `POST /api/catalog/legacy-row-lineage`: accepts hashes ONLY from the fifteen allowlisted nontransactional Access master tables, no names, values, patient data, passwords, laboratory results, amounts, templates, or uploaded MDB files. Requires live organization-wide catalog authorization; tenant lock, retries/duplicate protection and audit. Counts are claims, not source certification.
3. `PATCH`: explicitly classify each fingerprint as UNRESOLVED / AMBIGUOUS / NOT_IMPORTED / MAPPED / APPROVED_MAPPING; exact source → target identity only for allowed target types and existing tenant-scoped masters. Scoped pricing and clinical permissions are checked again in the transaction. Organization lock plus revision CAS; independent source author/mapper versus mapping reviewer. A reviewed **mapping is not clinical/financial value approval**.
4. `GET`: no-cache, tenant-scoped cursor-limited recorded row fingerprints/classification counts. Bilingual AR/EN operator workflow within the existing import reconciliation ledger; manually entered source staging row/target IDs are optional, exact checked when supplied.
5. Local Windows read-only `scripts/legacy/export-row-lineage.ps1`: extracts from Access ACE allowlist using HMAC-SHA256 with a private high-entropy key; never emits source row values; stable duplicate fingerprints, chunked JSON, source file before/after hash; the private key and MDB remain outside GitHub.
6. Pure safety regressions and a real **two-connection MariaDB** test for unique row identities, tenant fencing, claim races/CAS, rollback and price snapshot immutability; explicit CI command.

## Current safety boundary / Stage 126 continuation checklist
- [ ] Verify exact feature HEAD CI including migration, test:safety, MariaDB integration, tsc, ESLint, i18n/theme and Next production build.
- [ ] Review the remaining composite configuration workflow: Stage 117 package, price-list-package-item and range source rows are still **review-only**. No claim that clinical ranges, components, package membership, new prices or legal contracts have been financially/clinically approved or activated.
- [ ] Evaluate gated review-to-commit per import class using independently accepted clinical and financial signatory policy, not a signed source file alone.
- [ ] Confirm row-level source parity only when all pages from an authorized trusted MDB and their source fingerprints can be reconciled; on-server verification is **false** and operator mapping remains a claim until independent checking.
- [ ] Confirm referrer/client/source codes, package tariff and specialty range lineage with approved masters when actual source data can be processed safely.
- [ ] PR Draft → exact SHA success → Ready → expected-head merge → independently successful main CI → owner Hostinger deploy.

## Deferred external evidence — not a software PASS
ACE Windows access and the actual cleaned MDB (privately supplied), medical range / specialty approval, commercial rate and contract authority, clinical/browser/device UAT, Hostinger schema migration backup and final business cutover are NOT satisfied by source code or CI.

## Local evidence generator (not requested from owner during code development)
Use a trusted Windows system with ACE and a securely generated private random key file (minimum 32 bytes):
```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\legacy\export-row-lineage.ps1 `
  -MdbPath "C:\private\Family lab -test.mdb" `
  -HmacKeyFile "C:\private\row-hmac.key" `
  -OutputDirectory "C:\private\family-lab-row-evidence"
```
Keep MDB, key and evidence folder private. Upload only deidentified JSON through the scoped LIS interface **after software completion**, following organizational policy; never commit such files to GitHub.
