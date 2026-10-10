# Stage 48 - Manual Unit Catalog Identity Governance

Starting baseline: Stage 47 merged main at 3d67c8cd67c0d54ad84af35ad0b9f69d39e5364f, CI #955 SUCCESS and user-confirmed Hostinger deployment. Repository PUBLIC.

## Defect
The manual unit creation route did not coordinate with legacy unit preparation and batch imports. Unit symbols are not uniquely constrained at database level and different unit codes may have matching aliases. This creates ambiguous legacy clinical measurement unit resolution. Inactive units may also reserve existing symbols.

## Fix
- Validated unit code, symbol, names and UCUM field lengths, plus control-character rejection. No silent truncation or conversion.
- Used the existing legacy unit alias normalizer to find code/symbol conflicts against active and inactive organization masters.
- Added a transaction with organization row lock, live active branch and persisted user branch grant checks before re-reading units and creating the new one.
- Committed the master and audit event together. Other master creation paths also now audit atomically.
- No schema migration, no update to existing unit identities, reports, clinical values or invoices.

## Tests
- Stage 48 deterministic helper, source policy and ordering checks.
- Stage 48 MariaDB independent two-session test: organization lock, competing unit creation, inactive alias, branch grant, tenant isolation.
- Preserve full CI migrations, safety and MariaDB regressions, TypeScript, lint, Arabic/English and theme checks, Next production build.
- Require final exact feature CI success and separately final merged main CI success.

## Boundaries
This is a conservative alias identity safety gate, not semantic equivalence or UCUM conversion, nor a complete configuration-bundle import. Independent database writes outside controlled routes do not share this lock. All 88 Master Scope sections remain binding. Analyzer Bridge PR #128 remains separate Draft. Clinical, billing, equipment, scanners, external providers, backup restoration and end-to-end manual acceptance remain deferred until implementation is complete.
