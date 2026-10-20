# F2 — Ten-class independent policy review scope gate

## Problem and effect

The native signed configuration bundle has ten export classes. PR #333 fixed drift observations and governance triage for all ten, but the *separate* `validatePolicyReviewBatchScope` preflight used by policy reviewer GET, POST, and discovery queue still counted only six live master classes, omitted linked panel/package memberships and package-price parent scope, and did not require client/contract tariff IDs to be null. A valid review-only source whose linked clinical membership or private tariff context had changed could therefore pass this reviewer gate without proving full current scope. No clinical/financial apply was possible, but the independent policy review evidence could be misleading.

## Change

- Examine the complete bounded DRAFT batch, not just the displayed queue subset.
- Verify PANEL/PACKAGE signed-source and normalized membership correspond one-to-one (test UUID, linked test code, display order and required flag), then bind every test ID to the tenant/branch/department-filtered LabTest scope. Reject mismatched, malformed or repeated identities.
- Require PRICE_LIST_PACKAGE_ITEM source/normalized equality for package/list UUID and codes, currency, price, status and effective window, then verify current branch and clinically visible entire package membership. A correctly HMAC-signed source is insufficient if persisted staging identities diverge.
- Count all ten master entity types, including CONTAINER, PANEL, PACKAGE and PRICE_LIST_PACKAGE_ITEM, in the *same transaction* as reviewer audit capture.
- Exclude all source/referrer/client/contract price lists from generic catalog policy review by checking live nested tariff fields and refusing untrusted private source linkage.
- Use fail-closed count comparison on the union of staged and linked master IDs. Then **re-read every live PANEL/PACKAGE membership** inside the same reviewer transaction and compare the complete set of immutable test IDs, display order and PANEL `required` flags with the staged source-verified projection. Having all members inside the permitted branch is not sufficient if the live composite has changed since staging; mismatches return `policy_review_batch_scope_changed`.
- This closes a stale-review-evidence gap and does **not** authorize changes or imply that prices, clinical definitions or signatures were approved.
- Preserve non-committable CONFIG_BUNDLE_REVIEW and CSV_REVIEW and all existing author/reviewer separation.

## Verification and release gate

- Pure unit tests cover all ten class identities, member duplicates, malformed package relationships, branch revocation and private tariff linkage; static checks tie the reviewer queue/route to the shared scoped validator.
- Real MariaDB two-session integration exercises tenant-locked SQL membership, package-tariff and container visibility on synthetic rows; off-branch membership, revoked tariff branch, in-scope display-order/required-flag drift and cross-tenant container fail closed. Static tests independently assert the production GET/POST/queue paths call the same Prisma scope validator; direct Node integration cannot import the Next.js-only generated Prisma path without a test-specific bundling layer.
- No schema migrations or configuration apply, no signatory credential inference. Approval workflow, domain policy, medical/financial signing and version-safe immutable application remain **F2 OPEN/BLOCKED_EXTERNAL** until qualified decisions.
- **Hostinger deploy HOLD** per owner 2026-10-20 instruction. Continue GitHub PR/CI only. Latest *owner confirmed deployed* version is `d74115933bb24d745be4412883084fb54d8c152e`; `main` `66919fede47230277a74781b3ef4f9077713c3f4` has green CI #1839 but is not confirmed deployed. Do not promote a new PR to production or F3. No owner browser testing before F7.
