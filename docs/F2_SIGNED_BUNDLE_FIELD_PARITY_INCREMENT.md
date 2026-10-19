# F2 — Atomic configuration bundle source-field parity (engineering increment)

**Baseline:** F1 owner-confirmed deployed `8bc744dd9578ea4f3b8d684f0a2460b97cfd63a4`. Master Scope **§87 remains OPEN** until field-complete approved apply and re-export proof; F2 has multiple separately testable engineering gates.

## Verified source limitation

The current LIS already supports tenant/branch/department-filtered CSV/XLSX export, a signed transactional JSON bundle covering **10 classes**, review-only import staging, drift vs live values for all 10 classes, source SHA-256/HMAC and expert finding dispositions. It deliberately **does not** apply an uploaded CONFIG_BUNDLE_REVIEW, and policy proposals are explicitly **unapproved drafts**, not a clinical/finance approval.

The atomic exporter and the live drift inspector each maintain a separate `select` projection. If one projection silently drops a field, the diff may erroneously appear `UNCHANGED`. Old v1 imports also accepted missing exported keys (for review-only), so that a partial bundle looked like an ordinary signed one. Although no automatic live write was possible, the source completeness must be made explicit before qualified signoffs.

## Change delivered in this increment

1. Use the existing 10-type source allowlist as the **single canonical set of expected top-level source fields**.
2. Automatically embed `fieldContract: {version:1,classes:[{entityType,fields}]}` inside the atomic JSON **before server HMAC signing**. Field arrays are sorted and class order matches the requested groups.
3. Before returning any bundle, check that **every exported record** contains exactly the declared fields. Fail with `bundle_export_field_projection_incomplete` rather than produce misleading parity evidence.
4. On JSON review intake, validate the signed manifest, class order, field sets and every source record's keys **before any review batch write**. Reject forged/incomplete source contracts. Keep all rows `DRAFT` and all clinical/price master writes blocked.
5. Legacy v1 bundles without a field contract may still be staged strictly as `LEGACY_NO_FIELD_CONTRACT` with `SOURCE_FIELD_CONTRACT_NOT_PROVEN` warning, regardless of whether their original HMAC attestation verifies. They are **not upgraded** to complete source parity.
6. Persist only a non-sensitive `fieldContractStatus` in the existing staged batch summary and audit; never introduce a new API for unapproved activation.
7. TypeScript AST safety regressions parse the actual Prisma `select` trees for all 10 models, checking **export versus live drift are identical down to nested relations**, and top-level fields equal the source allowlist. This explicitly covers reference interval / critical limits, effective-dated prices and nested private-tariff scope metadata.

## Tests / security

```sh
npm ci
npm run test:safety
npx tsc --noEmit
npm run lint
npx next build
```

The new F2 test suites reject tampered HMAC, missing/extra keys, changed/reordered/duplicate class contracts and inadvertent export-drift field divergence. Existing catalog authorization and MariaDB integration tests stay enabled; no schema migration, production write, patient values, device commands or unapproved financial/clinical activation.

## Still required before closing all of F2

- Authorize a **field-complete diff → independently approved configuration apply** with approval identities, branch scopes, medical/finance signoffs, immutable revisions and deterministic failed/duplicate replay behavior. The human approval basis is still undecided; current `catalog-policy-options.ts` describes proposals only.
- Define which mapping and selected configuration categories in §87 are eligible for governed source import (e.g. test/unit aliases versus analyzer mapping). Do **not** blend vendor-specific analyzer mappings with generic catalog import or bypass their existing separate maker/checker approval.
- Prove a live, authorized **export → stage → domain-specific approve → atomic apply → re-export** round-trip for every agreed mutable field, including exact DECIMAL values and historical report snapshots. Failing to preserve history must block.
- Keep `CONFIG_BUNDLE_REVIEW` bulk commit forbidden until the applied path actually enforces those invariants. Unknown clinical rules and tax/currency policy are explicitly `BLOCKED_EXTERNAL`, **not** auto-accepted or removed from scope.

**Do not mark F2 complete or start F3 on this single increment.** New JSON metadata remains an evidence safeguard, not a restore file, external signature, clinician approval or browser UAT. F7/F8 remain deferred.
