# Stage 53 — Immutable, Snapshot-Bound Expert Review Triage

**Deployment gate:** Stage 52 main SHA `c7b8d3f6420115652dcbc426a1fbabeb05cbb6a3` was explicitly confirmed deployed on Hostinger by the owner before this work. Main CI #970 completed SUCCESS; repository checked PUBLIC. All 88 sections of `02_MASTER_SCOPE.md` remain binding.

## Product gap addressed
Stage 52 could detect changes between original signed/unsigned configuration bundles and currently authorized live records, but there was no durable, clinically/financially separated way to flag specific discrepancies for expert assessment. A stale browser preview must not be accepted as evidence after the live clinical value, price, link, source, or batch snapshot has changed. There is **no authorization yet to activate imported ranges, units, components, or prices**, and an expert review flag is not such authorization.

## Implemented
- `src/lib/catalog-drift-triage.ts`: purpose-separated HMAC-SHA256 observation tokens over the original batch checksum, source record, freshly serialized live record, record number and entity type. Tokens include exact decimal, timestamp, clinical/range and currency/linkage provenance without disclosing raw values. Invalid tokens are rejected with constant-time comparison.
- Existing Stage 52 `GET /api/catalog/imports/[id]/bundle-drift` additionally provides a per-row observation token and recent historical flag metadata after full batch authorization.
- New `POST` on the same route accepts **only** `{rowNumber,observationToken,reasonCode}` using a strict bounded 1 KiB JSON body. A fresh **REPEATABLE READ tenant-lock transaction**, full-batch 5,000-record foreign/branch/department checks and current role-permission intersections are required **before** checking the record's current HMAC.
- **Clinical** review is required for TEST, COMPONENT, UNIT and REFERENCE_INTERVAL records. **Financial** review is required for PRICE_LIST/PRICE_LIST_ITEM records. The reviewer must hold `catalog.manage` **and** the relevant separate current management grant; session-only or revoked database grants never suffice.
- Mismatched or stale observation tokens result in HTTP 409, never an expert flag. `SOURCE_VALUE_CHANGED` cannot be asserted for an unchanged source. Repeat submissions of the same current token/reason do not insert duplicate audit records.
- Valid triage creates only an append-only `CATALOG_BUNDLE_EXPERT_REVIEW_FLAGGED` AuditEvent linked to the precise staged source-row ID. Stores actor, branch, batch/row, domain, standardized reason, drift disposition, safe field names, source signature provenance and HMAC fingerprint. **No raw price/reference values, no secrets, no free-form PHI-containing comments, no mutations to catalog, results, reports, invoices or existing import rows.**
- Bilingual Stage 52 review page provides an explicit **Flag for expert review** button and latest flag evidence; all UI and API responses explicitly set `approved:false`, `activated:false`, `liveWrites:false`.

## Automated acceptance
- `tests/stage-53-catalog-drift-triage.test.ts`: HMAC changes if critical range/Decimal/timestamp/batch/row/key changes, invalid tokens, clinical-vs-financial grant matrices, no live writes, snapshot re-evaluation and safe audit structure.
- `tests/stage-53-catalog-drift-triage-mariadb.integration.test.ts`: two **independent MariaDB connections**, queued transaction lock after branch/department revocation, no unauthorized audit, stale token rejected after a committed test-value change, fresh token permits audit-only evidence, foreign organization inaccessible and master values preserved.
- Dedicated MariaDB suite added to CI. Migrations deploy/status, Prisma generate, full safety suite, all earlier MariaDB suites, TypeScript, ESLint, AR/EN theme/i18n checks and production Next.js build must pass on final PR head and new merged main SHA.

## Important limitations and deferred work
- This is **triage / expert review request**, not medical approval, effective-dated reference range activation, critical-limit validation, financial authorization, price activation, release or amendment of clinical history, electronic signature or legal attestation.
- Review history is append-only in AuditEvent. Long-lived operational review queues, explicit designated medical/finance signatory assignments, staged-value replacement policies, effective-date conflict approval and cryptographically versioned key rotation remain future delivery; **never infer approver authority from the triage flag**.
- Evidence HMAC is derived from the deployment secret already required in Stage 51. Rotating that secret invalidates existing browser tokens (refresh review with the new key). Do not expose keys in logs, docs or GitHub.
- Full physical analyzer and barcode device testing, manual clinical and finance commissioning/UAT, disaster-recovery restore exercises, security review and host-specific evidence remain **DEFERRED until full implementation**, not passed or waived.
- No new schema migration and no removal of features. Draft Analyzer Bridge PR #128 remains open and unmerged.
