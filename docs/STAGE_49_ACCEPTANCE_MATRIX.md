# Stage 49 — Transactional, Live-Scoped Native Configuration Bundle Review

**Baseline:** Stage 48 main `8a9a397ed7213b6eb95adbf072f6273075f63ed8`, CI #960 SUCCESS, Hostinger deployment independently confirmed by the owner. GitHub repository verified PUBLIC.

## Verified defect
Stage 46 native JSON bundle review staged six configuration classes in DRAFT/WARNING with no live writes. The upload route, however, checked active branch/department grants, scoped master identities and financial price-list visibility **before** entering the persistence transaction. A scope revocation or tenant-scoped master mutation could occur after those reads but before staging, producing a review batch authorized by an earlier snapshot. Staged source values may include clinically sensitive reference intervals or financial prices. New clinical or financial activation is still prohibited.

## Stage 49 implementation
- Use an organization-row `FOR UPDATE` lock at the start of the review staging transaction (coordinated with legacy safe-master import and manual/legacy unit routes).
- Reload actual active branch and persistent user branch/department grants **after** acquiring that lock. Intersect existing session grants with live grants to avoid silently expanding access if a scope changed. A restricted session losing all applicable department grants fails closed rather than becoming globally unscoped.
- Recheck every submitted master and parent linkage (TEST, COMPONENT, UNIT, REFERENCE_INTERVAL, PRICE_LIST, PRICE_LIST_ITEM), branch and department scope and price-list type **inside the transaction**; commit the bounded source-only DRAFT/WARNING staging and audit event atomically only after all checks pass.
- Return 403 for revoked/inactive scope and 409 for inconsistent source identity. Preserve generic price-list visibility (organization/branch only), source checksum, original Decimal strings, original UUID source provenance, and the six-class read-only contract.
- No database schema migration and **no active master, price, clinical reference interval, result, report, patient or invoice mutation**.

## Acceptance gates
- `tests/stage-49-bundle-live-scope.test.ts` asserts transaction lock/read order, live branch and department authorization, no unauthorized writes and default no-grant policy.
- `tests/stage-49-bundle-live-scope-mariadb.integration.test.ts` exercises independent MariaDB sessions. The first transaction revokes branch/department grants before a second transaction can take the organization lock, and the second sees revoked permissions and cannot stage; an explicitly reauthorized DRAFT review remains source-only and existing clinical master data remains unchanged. Foreign-tenant test identities do not qualify.
- CI runs new and previous MariaDB tests, Prisma migrations, safety, TypeScript, ESLint, Arabic/English/theme checks and Next.js production build on the exact feature HEAD and independently on merged main.

## Explicit limitations and deferred scope
The organization lock coordinates writers already implementing the convention; not all unrelated standalone catalog CRUD routes share it. Existing authorization middleware/session semantics are unchanged. This **does not** provide an atomic historical export, cross-tenant restore, clinical review approval, price activation, FHIR/HL7 device validation, real backup restoration or Excel import. All 88 Master Scope sections remain binding. Analyzer Bridge PR #128 stays independently Draft/unmerged. Manual clinical, financial, device, security/provider and complete end-to-end UAT remain DEFERRED until the LIS implementation is complete; automated CI is not clinical acceptance. Hostinger confirmation is separate.
