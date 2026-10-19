# F2 — Signed nested source projection completeness

## Engineering objective

Master Scope §87 requires a trustworthy source→review→diff before any independently approved and version-safe configuration apply. PR #331 proved that the ten selected Prisma export types have exact top-level signed source fields and equal export/drift selections. It did not prove completeness of *nested* selected relations inside each record. A source can have all top-level keys while omitting a related unit code, clinical test identity, composite membership field, or a price-list currency/private-tariff marker.

## Implementation

- Keep the canonical nested export projection tree in `src/lib/catalog-bundle-source-boundary.ts`. It covers all ten selected types and explicitly enumerates related test/component/unit codes, panel/package member fields, and price-list scope, currency and private tariff links.
- For **fieldContract v1 present** sources, `verifyBundleFieldContract` now rejects every missing/additional nested key, malformed member array/object, or absent mandatory relation via `bundle_field_contract_incomplete_nested_source`. `COMPONENT.unit: null` is the only intentionally nullable relation; the key itself remains mandatory. Existing legacy/no-fieldContract sources remain `LEGACY_NO_FIELD_CONTRACT`, DRAFT only, never silently promoted.
- Assert that these nested paths match the real Prisma export `select` tree, using a TypeScript AST test; the existing export↔live-drift AST equality remains. Adding/removing any projected relation field without updating the contract now fails automated safety tests.
- Exercise malformed nested records **re-signed with a valid synthetic HMAC key**: attestation may verify, but the shape must still be rejected. No production keys/source data are committed.

## Security and release boundaries

- No schema migration, clinical rule choice, tariff revision, master activation or live master writes. Existing `CONFIG_BUNDLE_REVIEW` and `CSV_REVIEW` commit denial remains untouched.
- Incoming source still must pass its preexisting tenant/branch/department and domain-specific authorization, source disclosure filtering, signed attestation, identity and replay checks before DRAFT review staging.
- This verifies *source presence*, not the truth/clinical safety of a value, cross-instance identity mapping, a professional decision, or the ability to apply it.
- Expert signatory separation, MFA/e-signature policy, mutable/review-only field inventory, version-safe transaction and history, MariaDB approved apply/rollback/replay tests and re-export parity remain **F2 OPEN / BLOCKED_EXTERNAL where owner/qualified policy is required**.
- No F3 start, no F7 browser QA, no F8 clinical GO.
