# Stage 117 — Controlled Composite Configuration Bundle Admission and Reconciliation

## Source and verified Stage 116 gap
- Base main: `125b1776aa46afa8c6684d3341a68bac78710648`; independent main CI #1243 SUCCESS; owner confirmed Hostinger deployment.
- Binding scope: `02_MASTER_SCOPE.md` §§7–8, 16–17, 41, 63, 79–80, 87–88.
- Stage 116 exported `PANEL`, `PACKAGE` and `PRICE_LIST_PACKAGE_ITEM` with complete ordered membership, exact decimal and dates. The inbound native bundle review recognized only the original six groups: it limited group count to six and treated unrecognized composite records as plain test-price records.
- Existing tests, members, packages and prices already live in Prisma. No duplicate schema or medical assumption is appropriate.

## Delivered and non-destructive boundaries
1. Native JSON bundle review now understands **all nine exported classes**; no silently discarded or misclassified composite groups. Strict deterministic validation of source UUIDs, panel/package identities, complete non-empty membership, unique linked test IDs, test codes, member order and the panel `required` flag. Invalid nested input fails the entire payload.
2. Package prices require `pricing.manage`, organization- or authorized branch-level price lists, explicit currency, original DECIMAL(18,4) text and effective window. Client/referrer/source/contract tariffs are **never admitted** via this generic path, even if a stale source claims a public scope.
3. Under the existing active-organization transaction lock, recheck **current** actor roles and permissions, real branch/department grants and all linked test IDs, panel/package membership and price-list/package identities. Entire membership must remain within the allowed clinical scope. Partial/foreign or stale membership, price, currency, dates and status are rejected with no source batch.
4. Composite tariff parent lists and packages are independently checked against live authorized masters; source UUIDs serve only as **same-organization review identity pointers**. This is not a cross-tenant restore or a rewrite of live master records.
5. Successful admission persists only an **author-bound `CONFIG_BUNDLE_REVIEW` DRAFT** and warning source rows, normalized evidence, SHA-256 fingerprint, source consistency/attestation and audit event. Existing safe-master commit endpoint expressly refuses this source type. No panel membership update, price creation, activation, historical invoice recalculation, result release or report-version modification.
6. The bilingual staging UI accurately explains nine supported groups and review-only semantics. Batch discovery and detail pages protect newly included package tariff and complete membership evidence before loading it; scope revocation denies disclosure.
7. The protected prior six-class workflow remains supported without altering its safe-master import or clinical/financial governance.

## Tests and CI
- `tests/stage-117-composite-bundle-safety.test.ts`: complete nine-class parser, duplicate/invalid membership and required flags, decimal/time validation, private tariff denial, foreign-tenant rejection, non-committable staging and scoped disclosure guards.
- `tests/stage-117-composite-bundle-mariadb.integration.test.ts`: actual MariaDB fixture with branch-restricted departments, mixed-membership panel, public/private tariff scopes, exact DECIMAL(18,4) preservation and two database sessions proving repeatable-read snapshot vs later membership drift.
- CI explicitly invokes new MariaDB test. Existing `test:safety`, all prior MariaDB integration suites, Prisma migrations/generate/status, TypeScript, ESLint, AR/EN and RTL checks, and production Next.js build remain mandatory.

## Deliberate exclusions
- This completes **native composite bundle admission and review** of Stage 116 exports, not financially or clinically signed configuration activation. Source-bundle review rows cannot be used by the legacy safe-master commit action; any later write/approval workflow needs explicit scope and dual signatory policy.
- Cross-organization portability and newly created/mismatched external master mappings are not inferred from source UUIDs. Full Access MDB data reconciliation and specialty configuration sign-off belong to later targeted stages.
- No database migration, no production data updates, no new provider configuration or secrets.
- Draft PR #128 Analyzer Bridge and Draft PR #209 report interpretations remain OPEN/UNMERGED/untouched.
- Manual clinical, browser, device, security, provider, accounting, and backup/restore UAT are **DEFERRED** to end-of-build, not marked PASS.

## Release gates
- [ ] Exact final feature HEAD CI SUCCESS
- [ ] Draft PR reviewed and Ready; merge with exact expected HEAD SHA
- [ ] Independent green main CI on resulting merge SHA
- [ ] Owner deploys resulting SHA on Hostinger
