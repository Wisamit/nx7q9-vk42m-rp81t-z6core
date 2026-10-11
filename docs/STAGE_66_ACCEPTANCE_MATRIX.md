# Stage 66 — Context-Bound Signed Policy Review Queue Cursor

## Objective
Preserve the integrity and context of Stage 65's multi-page independent review discovery when sessions, branches or draft histories change between HTTP requests. A pagination token must never become a cross-reviewer/cross-branch capability or silently continue after a new policy revision.

## Implemented
- `src/lib/catalog-policy-queue-signed-cursor.ts`: domain-separated `HMAC-SHA256` signed, canonical Base64URL payload + hex signature, 20-minute maximum TTL. Token includes only page position, initial most-recent audit watermark and expiry. Organization/branch/reviewer identifiers are **not disclosed in the token**: they participate in the server-side signature. Verify with constant-time signature comparison, strict payload types, cursor shape, canonical Base64URL, nonascending event ordering, time bounds and original session context.
- `src/app/api/catalog/imports/policy-review-queue/route.ts`: existing deployment-managed catalog bundle secret (or APP_ENCRYPTION_KEY fallback) required; fail 503 when absent instead of producing unauthenticated tokens. Within the same organization row-locked `RepeatableRead` transaction and after intersecting original/live grants, verify the cursor for the current reviewer, tenant and active branch. Read the latest **all-actor** policy draft AuditEvent watermark in that scope and fail 409 on a changed watermark. Preserve the Stage 65 deterministic bounded keyset selection; only return 20-minute expiring signed continuations. No approval authority or raw audit data is exposed.
- `src/components/catalog-policy-draft-review-queue.tsx`: accept only correctly shaped signed continuations and, when draft history changes, clear any stale entries/selection and show AR/EN instructions to refresh from the beginning.
- `tests/stage-66-policy-queue-signed-cursor.test.ts`: scope substitution, tampering, expiration, legacy/invalid tokens, audit anchor drift, same-timestamp tie handling, server and bilingual UI structure, disabled signatory flags.
- `tests/stage-66-policy-queue-signed-cursor-mariadb.integration.test.ts`: two MariaDB connections, real append-only consecutive draft revisions under tenant row lock, second-connection read, cross-tenant/cross-branch denial and no clinical/financial master writes.
- `tests/stage-65-policy-queue-pagination.test.ts`: existing source assertion updated for Stage 66 HMAC context validation while retaining Stage 65 keyset tests.
- `.github/workflows/ci.yml`: dedicated Stage 66 MariaDB integration test, earlier gates intact.

## Tradeoffs and limits
- A new policy draft anywhere in the current tenant/branch intentionally expires the current pagination *watermark*, even if it is unrelated to the currently displayed batch. This is conservative; the reviewer refreshes the queue to restart from its top. Ordinary source/role changes may not change the watermark, so **every page and independent detail GET/POST still revalidates live access, all staged identities and the latest full audit history**.
- The 20-minute token is a navigation artifact, **not** a clinical or financial electronic signature or an authorization credential. Existing signed cursor tokens become invalid if the application key is rotated, the user changes active branch or switches accounts, or the token expires. This is fail-closed.
- Stage 65's unsiged legacy positional cursors are not accepted after deployment. A refresh obtains a new signed one; no persisted state or migration is needed.
- No new schema tables or migration, no applied catalog test/unit/price/range changes, no released clinical-result modification or patient history overwrite.
- Formal clinical and financial signing, MFA reauthentication policy, audit-backed legally valid signatures and versioned live application remain blocked pending explicit owner governance. Manual UAT is deferred until the full LIS is ready.
- Deployment on Hostinger requires successful CI on both feature HEAD and the exact merged-main SHA, followed by the owner's deployment confirmation.
