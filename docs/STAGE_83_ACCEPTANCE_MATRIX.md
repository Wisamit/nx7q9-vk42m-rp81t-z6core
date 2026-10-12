# Stage 83 — Controlled Legacy Client/Corporate Account Master Migration

## Baseline and Master Scope
- Baseline: Stage 82 merged main SHA `7e26abda8b6fb4a3ff947ffa59625e61790ccc74`, independent CI #1065 SUCCESS; owner confirms successful Hostinger deployment.
- Authoritative master scope: clients/referrers, organization-level identity, branch permissions, financial contract integrity, approved pricing and migration §88.
- Stage 82 supplied operator-reviewed bilingual CSV import for REFERRER, SOURCE, ORGANISM, ANTIBIOTIC, but **not for the corporate/client master ledger**. A direct manual replacement would be risky due to accounting and contract links.

## Delivered
- Extend the same established `/catalog/legacy-master-data` review/approval workflow with **CLIENT**. Only operators with **both** `catalog.manage` and `clients.manage`, an active authorized organization branch, may preview/apply client imports.
- Exact UTF-8 normalized header: `code,name_en,name_ar,type,phone,email,address_en,address_ar,payment_terms_days`. Legacy Access file columns must be reviewed and mapped to these exact fields; native MDB is **not** ingested directly.
- Explicit `type`: `INDIVIDUAL`, `CLINIC`, `HOSPITAL`, `COMPANY`, `INSURANCE`, or `OTHER`; missing/unknown types **rejected**, not guessed. `payment_terms_days` may be blank (NULL) or an integer from 0 to 3650, with no default credit term inferred; out-of-range, fractional, negative or malformed values fail the entire CSV.
- Support Arabic/English names, contact fields, bilingual postal address, standardized lowercase email and source CSV RFC4180 quoting. Strict header, code uniqueness, field sizes, max 200 rows / 64 KiB.
- PREVIEW remains **read-only** with organization/kind/content SHA-256 fingerprint, per-row existing code conflicts and explicit display of **client type and payment terms**. Existing organization/client codes block the entire batch, with no silent overwrite.
- APPLY requires a **CLIENT-specific consent token** `CREATE_CLIENT_MASTERS_ONLY_NO_CONTRACTS` and exact matching preview fingerprint. Inside a `Serializable` database transaction, client codes are checked again and new UUIDs are created via `client.createMany`, with a grouped and per-record AuditEvent. DB uniqueness races roll back the whole batch.
- These rows create **client master identities only**. The importer does not create/update contracts, client pricing, invoices, payments, receivables, credit policies/limits, referrer associations or historical audit rows. It does not activate insurance adjudication or backdate any price/term.
- All other Stage 82 master types remain supported without behavior changes.

## Automated acceptance
- `tests/stage-83-legacy-client-master-safety.test.ts`: validates safe parsing, Arabic/English, mixed optional/required fields, exact client type and payment term limits, tenant-bound fingerprint, typed create-only model path and explicit UI/route consent safeguards.
- `tests/stage-83-legacy-client-master-mariadb.integration.test.ts`: two actual MariaDB connections; create insurer and clinic with literal terms and bilingual metadata, verify no generated pricing/contracts/invoices; independent foreign-tenant same-code master; conflicting second row aborts first row atomically and leaves unchanged old client.
- Dedicated Stage 83 MariaDB gate added to CI alongside existing MariaDB clinical/financial suites, Prisma migrate deploy/status, typecheck, lint, bilingual UI checks, Next.js build.

## Deployment / safety boundaries
- **No migration, new environment variable, automatic MDB parsing or legacy financial balance import**.
- Payment terms entered during import become *current client-master defaults* on NEW clients only; **never** mutate a released invoice's stored due-date or payment-term snapshot. Reviewer must verify source payment terms before approval; empty means no default.
- Client identity mapping may require explicit later review before connecting legacy referrers or client contracts. No automatic cross-entity relationships.
- This is not a patient historical record migration, no live legacy transactional data conversion, and no clinical/financial operator UAT has been asserted.
- Owner separately confirms Hostinger deployed merged SHA. PR #128 Analyzer Bridge stays OPEN/DRAFT/UNMERGED untouched.
