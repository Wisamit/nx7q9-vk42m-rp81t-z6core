# Stage 144 — Private ACE row-HMAC replay of Access evidence (§88)

## Purpose
Stage143 verified the ORIGINAL local MDB bytes against coverage + paginated HMAC manifest metadata. That does **not** establish that an Access reader calculated the claimed row fingerprints. Stage144 adds a **local private replay** which rereads the 15 whitelisted configuration tables using Microsoft ACE and the **same private HMAC key** via the existing Windows read-only extractor, then checks the freshly generated row evidence against the original reviewed HMAC pages exactly.

## Safe operator sequence
On a trusted Windows machine with the Microsoft Access Database Engine, PowerShell, Node 22.18+ and an immutable read-only local copy of `Family lab -test.mdb`, have the **original** coverage manifest and row digest directory from Stage143, and the **same key file** used for the original digests. Use a separate private scratch root owned by the operator:

```powershell
powershell -File scripts/legacy/verify-access-row-replay.ps1 -MdbPath "C:\private\Family lab -test.mdb" -HmacKeyFile "C:\private\secret.bin" -CoveragePath "C:\private\coverage.json" -OriginalLineageDirectory "C:\private\original-lineage" -PrivateScratchRoot "C:\private\scratch"
```

The wrapper creates a unique replay directory, re-reads the MDB with the existing `export-row-lineage.ps1` extractor, compares the original manifest pages against the fresh pages using `verify-evidence-package.mjs --ace-replay-dir`, and deletes temporary HMAC pages in a `finally` block. Any bad/missing page, stale/different HMAC key, schema/source mismatch, forged digest, missing occurrence or changed original file fails closed. The CLI does not display HMAC digests, private keys, raw laboratory values or patient rows.

Never upload the MDB, secret, private pages or patient details to GitHub, CI, Hostinger staging or LIS APIs. A different key cannot verify the old evidence; do not silently regenerate a fresh key and replace source evidence.

## Trust limits
`sameExtractorAceReplayMatched=true` means two supplied evidence directories matched and, **when invoked through the trusted Windows wrapper**, the fresh pages were produced by rereading the Access source using the original extractor and HMAC key. The bare Node CLI alone cannot prove the origin of its `--ace-replay-dir` input. This is **same-implementation replay**, not independent source certification, independent second algorithm, proof of every historical row value, signed reconciliation to the LIS target, clinical reference range approval or financial contract approval. `sourceHmacIndependentlyVerified` / `targetMappingCertified` / `clinicalApproved` / `financialApproved` / `cutoverApproved` deliberately remain false. The system never activates clinical/financial master records.

The container CI cannot execute Windows Microsoft ACE against the real uploaded MDB. Automated Stage144 regression uses only an entirely synthetic file and 501 digest rows across 2 pages, including valid-looking HMAC falsification, missing/duplicated pages, broken occurrences, distinct HMAC keys and sanitized CLI failures. Actual replay on the owner's Windows/ACE environment is **NOT_EXECUTED**.

## Scope / release gates
Section §88 remains OPEN until source files, all validated clinical/financial mapping evidence and qualified independent expert acceptance exist. §§75/86/87, issue #250 Stage132 88-case physical UAT (NOT_EXECUTED) remain open; GO/NO-GO stays NO_GO. Issue #265 retains the owner-mandated full every-page UX inspection, color/date/time settings, AR/EN RTL/LTR, and one-third-width centered form-modal conversion before final release.
