# Stage 146 — Catalog bundle admission boundary (§87)

## Source-grounded issue

Stage 145 guarded the two generic catalog EXPORT paths against private
client/referrer/source/contract tariffs. The corresponding JSON review IMPORT
still used organization/branch-only lookups for the price-list master and
test-price item; only package-price entries were individually filtered.
A supplied bundle could reference a private tariff for DRAFT evidence while
generic exports rightly withheld the same tariff. DRAFT data can later be read
by generic catalog reviewers and must obey the same disclosure boundary.

## Implemented engineering change

- All three inbound tariff identity lookups share genericCatalogPriceScope
  with both export routes, requiring the four private references to be null.
- Admission rejects private linked IDs in top-level and nested tariff objects,
  including legacy broad-scope private lists, before any review batch is saved.
- V1 JSON bundle records for all ten supported groups have an explicit
  source-field allowlist. Unexpected top-level or nested metadata is denied
  before persistence; ordinary older optional export fields remain supported.
- Same tenant, active granted branch, scoped clinical members, approval
  permissions, audit records and historical snapshots are still enforced.
- Exact price decimal strings remain unchanged. The operation is DRAFT and
  review-only; no clinical values, tariffs or references are applied.
- Synthetic safety/unit tests and disposable MariaDB integration cases
  cover four private reference fields, foreign tenants and branch grants,
  cross-scope envelopes, all ten record classes and nested field injection.
  The MariaDB case runs in the full CI job.

## Explicit limits and acceptance

This is not full, lossless configuration roundtrip or independently approved
activation. Clinical and finance expert approval, complete field-level parity,
effective-dated decisions and qualified data recovery are outstanding. Master
Scope §87 remains PARTIAL, §§75/86/88 remain open for source/vendor/jurisdiction
evidence or decisions, and Issue #250 stays NO_GO. Issue #265 remains OPEN:
source coverage and private staging preflight are not real browser acceptance.
The public repository must never contain patient data, real legacy MDB rows,
screenshots, cookies or secret session states.
