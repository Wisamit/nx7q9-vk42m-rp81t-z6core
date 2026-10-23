# F8 §86 — Tax publication authorization and active-reference transaction locks

Baseline: last verified main `3fd364d06cfdc65efe679ebea7199f716992e159` after PR #380; independent main push CI #40002521727 COMPLETED SUCCESS 225/225. Master target scope is still ALL original 88 sections in `02_MASTER_SCOPE.md`.

## Verified software integrity gap

The tax-rule POST verified current operator branch scopes and whether the referenced TEST/PACKAGE was ACTIVE using separate **pretransaction** queries, then independently started a SQL transaction and inserted a new tax policy revision. Even if a branch had just been deactivated, a branch scope revoked, or a service retired, `tx.branch.updateMany({where:{status:'ACTIVE'}})` could affect ZERO rows and be ignored, while `tx.taxRule.create` + audit succeeded. A global rule could also apply to a newly active branch the author did not have live scope for. The earlier change in PR #380 addressed exact-field truncation but not this time-of-check/time-of-use gap.

## Implemented software correction

- Move authorization to `lockTaxPublicationAuthority(tx,...)` **inside the SAME database transaction** as branch `taxConfigVersion` revision increment, rule insertion, audit and effective date.
- Lock ACTIVE organization row, all ACTIVE tenant branch rows, and the selected ACTIVE same-tenant TEST/PACKAGE source row with parameterized `FOR UPDATE`. Reject stale/inactive organization/branch/service before writing.
- Recheck current ACTIVE user plus same-tenant ACTIVE role with `billing.tax.manage` permission; live branch grants must also fall inside the original request session branch ceiling. For organization-wide rules require EVERY CURRENT active branch and at least one active branch to be authorized in both scopes.
- Check that the actual `updateMany` affected branch count equals the locked and validated expected set. A changed scope cannot silently apply a partial global tax revision; any mismatch throws and rolls back the entire transaction, including tax-config-version increment and audit.
- Preserve existing explicitly entered treatment, inclusion mode and EXACT `DECIMAL(5,2)` percentage; previous rules, immutable invoice/tax snapshots, posted totals and money-scale calculations untouched.
- Pure role/branch/reference gate tests, source-order guarantee tests, and new two-session MariaDB regression for concurrent branch/service deactivation vs tax-publishing locks, wired to CI. No patient records or real billing created in fixtures.

## Boundaries

This is a software authorization/concurrency defect fix; it does **not** approve national VAT policies, accounting definitions or exchange rates. Qualified accountant + business policy approval still needed for §86. §75 analyzer/interference clinical policies, §87 governed full-field activation and §88 authentic original MDB provenance still outstanding. No specific medical or fiscal policy inferred.

F7 private protected visual UAT 0/486 NOT_EXECUTED; F8 qualified 88-case UAT 0/88 NOT_EXECUTED; seven signed external GO gates absent: **NO_GO**. Browser visual review in PUBLIC GitHub remains SKIPPED by privacy design. Hostinger deployed SHA, qualified devices and real backup restoration NOT_VERIFIED. Do not request owner/device manual testing until all software implementation is delivered.

Required release discipline: latest feature HEAD full CI COMPLETED SUCCESS; compare exact branch/PR/CI SHA; merge only with `expected_head_sha`; independent main push CI COMPLETED SUCCESS on exact merged SHA.
