# F3 — Local private source-to-target reconciliation

F3 software can be exercised with an entirely synthetic Jet file. Real MDB
data, private row-HMAC keys, patient records and finance records must stay
outside GitHub/CI and public deployments.

## Private local workflow (once real data are available)

Use the existing read-only Windows ACE tools to produce:
1. `coverage.json` for all 15 source configuration tables;
2. `legacy-row-hashes-*.json` manifest pages using one secret local key;
3. optional independent/same-extractor ACE replay evidence.

After staging the corresponding row identities in the LIS, export its entire
tenant-scoped HMAC identity ledger from a trusted workstation:

```bash
node scripts/legacy/export-lis-row-ledger.mjs --organization ORG_UUID --source-sha MDB_SHA256 --digest-key KEY_ID --out private-ledger.json
```

The command connects through local `DATABASE_URL`, uses a read-only,
repeatable-read database transaction and writes a new `0600` private JSON
file. Keep the file in a restricted folder. Never upload it to GitHub.

Check exact row-by-row parity against the original local MDB bytes:

```bash
node --experimental-strip-types scripts/legacy/reconcile-source-ledger.mjs --mdb private.mdb --coverage coverage.json --lineage-dir private-pages --ledger-json private-ledger.json
```

The returned report counts missing, unmatched, unresolved, ambiguous,
explicitly excluded and shared-target records across all 15 table types.
It deliberately does NOT assert that a target exists in the currently scoped
LIS unless a separate live existence check is performed. Nor can a private
script certify an independently qualified clinical/financial human approval.

`src/lib/legacy-f3-row-parity.ts` is the reusable pure matching core;
`tests/f3-legacy-row-parity.test.ts` and the private synthetic fixture
exercise its behavior. No patient rows or live source data are needed
for software development. Real-source certification remains a later gate.
