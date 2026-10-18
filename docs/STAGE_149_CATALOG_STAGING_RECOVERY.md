# Stage 149 — Private read-only catalog staging submission reconciliation

## Source-confirmed gap
Stage 148 / PR #308 already guarantees one durable batch per (organization, author, source, UUID submission key). The three clients still fail closed when a POST response is lost, but the user could not find the exact committed batch using that key while remaining on the page.

## Delivery
- `GET /api/catalog/imports/recovery?sourceType=...&key=...` is **read-only** and returns only the id of a previously created batch.
- A UUID is required. Exactly the three existing source types are accepted. The SQL/ORM predicate includes **organization, author, source type, submission key**.
- The organization lock, active user/branch/department intersection and live conditional pricing/range permissions are required before disclosing even the batch id. The batch detail page independently validates row-specific disclosure scope.
- The bilingual recovery action appears only after an attempted staging POST and explicitly checks the same key, without resubmitting source bytes or generating a replacement key.
- A missing or unconfirmed key **never** authorizes another upload: the original POST might still be committing. Response is private/no-store and never exposes uploaded rows or raw metadata.
- No DRAFT activation, clinical change, financial posting, analyzer activity, schema migration or automatic retry is part of this package.

## Evidence / release gates
- Automated safety policy and MariaDB author/tenant/source isolation tests; exact feature CI and independent merged-main CI required.
- Issue #265 **OPEN**: 81-route rendered AR/EN, multi-branch, mobile/desktop interactive visual review **NOT_EXECUTED**.
- Issue #250 **NO_GO**: qualified clinical, finance, privacy, vendor and Hostinger restore UAT **NOT_EXECUTED**.
- Hostinger deploy must be confirmed by owner for the merged SHA; source CI is not production deployment or clinical go-live.
