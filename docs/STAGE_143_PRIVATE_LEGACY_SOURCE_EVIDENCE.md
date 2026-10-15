# Stage 143 — Private Access MDB evidence package verifier (§88)

## What is verified
The existing Windows / Microsoft ACE extractors provide:
- `scripts/legacy/export-source-coverage.ps1`: source SHA-256/size and row counts + schema fingerprints for 15 allowlisted configuration tables.
- `scripts/legacy/export-row-lineage.ps1`: HMAC-SHA256 row fingerprints with duplicate occurrence numbers, 500 rows per page, using a PRIVATE random HMAC key.

The new local Node verifier checks **the actual MDB file bytes** using streaming SHA-256, checks its recognizable Jet header, and matches its basename, byte size and SHA-256 to the coverage file and every page. It then checks all 15 source types, table schema fingerprints, each expected page, exact per-page and per-table row counts, global digest sort order, duplicate occurrence continuity and a consistent HMAC key identifier. Missing tables legitimately have no lineage pages. An extra, missing, duplicated, swapped or malformed page is rejected.

## Operator procedure (local, private)

On a trusted Windows workstation with the matching Microsoft ACE Database Engine and PowerShell, keep the original cleaned MDB, evidence JSONs and HMAC key in **private** storage. Do not move patient/order/result records or the HMAC key into GitHub, a public artifact, or LIS APIs.

1. Extract the coverage metadata:
   `powershell -File scripts/legacy/export-source-coverage.ps1 -MdbPath "C:\\private\\Family lab -test.mdb" -OutputPath "C:\\private\\coverage.json"`
2. Generate a PRIVATE 32+ byte cryptographically random HMAC key (never put it in the repo) and extract lineage pages:
   `powershell -File scripts/legacy/export-row-lineage.ps1 -MdbPath "C:\\private\\Family lab -test.mdb" -HmacKeyFile "C:\\private\\secret.bin" -OutputDirectory "C:\\private\\lineage"`
3. Run the independent metadata-package verifier on the same read-only MDB file:
   `node --experimental-strip-types scripts/legacy/verify-evidence-package.mjs --mdb "C:\\private\\Family lab -test.mdb" --coverage "C:\\private\\coverage.json" --lineage-dir "C:\\private\\lineage"`

Save the output in a private evidence store. The tool emits only source basename, source hash, size, per-master-table counts and explicit **NON-CERTIFIED** flags.

Do not re-use an output directory containing old pages; extra chunks fail closed. Ensure Windows ACE and Node operate on one stable, backed-up source; concurrent MDB changes invalidate the hash anchor.

## Limits and current verified observation

The uploaded cleaned Family Lab MDB is an actual Microsoft Access Jet DB and its bytes can be hashed in the current environment. However, **the current Linux runtime does not have Microsoft ACE OLE DB**, and no source-table/row/clinical-value extraction has been performed in this stage. The only original-file facts determined locally are its byte length and SHA-256; these are not source-row evidence.

A matching file SHA is **not proof** that coverage rows or HMACs genuinely came from those bytes: the independent ACE extractor and private secret must be executed and audited by an authorized operator. Even complete, consistent metadata pages do not authenticate the values, one-to-one target mappings, patient identity, clinical method/ranges or effective financial contracts. Expert source validation, authorized review, and signed end-to-end cutover remain outstanding. There are **no** new live catalog writes, prices, or clinical activation.

## Automated regression
`tests/stage-143-private-legacy-evidence-package-safety.test.ts` uses a wholly synthetic Jet-header file and deidentified manifests to verify happy-path 15-table + multi-page/duplicate-row evidence, swapped/missing/duplicate/extra pages, mismatched source/schema/key, raw metadata injection, and modified-file detection.

## Release gates
- Issue #250: §§75, 86, 87 and **actual full §88 source reconciliation** remain OPEN. Stage132 qualified 88-case UAT is NOT_EXECUTED; GO/NO-GO remains NO_GO.
- Issue #265: owner-mandated all-page UI review (central palette and date/time rules, centered compact modals, AR/EN, RTL/LTR) remains OPEN after software closure.
