# F0 — Master Scope 88/88 structural audit and bounded triage

**Scope source:** exact original project attachment `02_MASTER_SCOPE.md`, SHA-256 `7442630f83228f995ea80c5c4c2d84d0f9cb577dae3791b65665c1ba5eebb7f0` (do not replace or remove any section). **Owner-confirmed Hostinger base:** `d65680ccee68281da33bc3d14e146d2c9054bfc3` with main CI #1819 SUCCESS. This is an F0 audit of code artifacts and known gaps, **not** a line-by-line security audit, browser visual pass, functional acceptance or clinical GO.

## F0 scope closure evidence

`docs/F0_SCOPE_88_TRIAGE.json` tracks all **88 master-scope sections** against the original names, historical Stage131 status, exact existing source anchor, selected direct test, minimum real-world evidence, accountable gate and role, unresolved qualification, scheduled F-phase and separate F7/F8 owner/professional acceptance boundaries.

- **88** anchored source paths existing; **83** selected existing test references; the historical matrix has **no direct selected test** for §§9, 18, 29, 72 and 81. This is **not proof tests are absent**; authentic coverage mapping and missing tests are F6 work.
- Historical classifications are **48 APPROVAL_DEPENDENT, 5 SOFTWARE_READY, 31 VENDOR_OR_REAL_WORLD_DEPENDENT, 4 BUSINESS_RULE_OR_DATA_UNRESOLVED**. All are unqualified *source classifications*, not clinical signoffs. In particular §§75, 86, 87, 88 remain unresolved.
- **81** page files checked against the canonical route manifest. The planned browser variants and screenshots remain NOT_EXECUTED, per the owner requirement to start **only after F6**.
- **88/88** real-world UAT cases remain NOT_EXECUTED, with **seven independent approval roles UNSIGNED**. The old Stage132 UAT SHA `cc14d531887bc00299d0728d2fcc95090d7493fd` is not the current candidate; pin at final release. Production clinical status **NO_GO**.
- **10 specific risks** are classified by known defect, external policy, functional gap or acceptance gate. Every risk has severity, affected code, assigned F1–F8 stage, accountable role, entry/exit criteria, and triaged status. `FIN-001` is a **verified current P1** (Number/toFixed money precision), explicitly assigned to F1, not prematurely fixed or marked complete in F0.
- Documentation and tests do **not** expose PHI, device secrets, HMACs, Access source rows or real user financial records to this public repository.

## Reproducible gate

```sh
node scripts/f0-scope-gate.mjs --check
node scripts/f0-scope-gate.mjs --json > f0-scope-evidence.json
node scripts/f0-scope-gate.mjs --markdown > f0-scope-evidence.md
node --experimental-strip-types --test tests/f0-scope-evidence.test.ts
```

CI creates and uploads the two non-sensitive reports. Regressions fail CI on missing/reordered source sections, broken source or historical test paths, unassigned P1 issues, missing approvals/qualified roles, route manifest drift, false clinical signoff, or advancing owner browser QA before the end of software delivery.

## F0 exit vs F1 start

1. Complete the 88-row source audit, phase and accountability map, 10-risks list, runnable positive/negative regressions, and documented limitations.
2. Exact feature SHA CI SUCCESS; merge safely; independent merged main SHA CI SUCCESS.
3. **Hostinger deployment is separate**: F0 only becomes owner-confirmed deployed after the user verifies exact new main SHA in Hostinger. There is no Hostinger deployment credential connected to this chat; GitHub merge must not be represented as a successful Hostinger deployment.
4. **Only then** begin F1, dedicated to financial precision in two price-list API endpoints and the price-list UI.

The bounded phase plan is [GitHub #327](https://github.com/Wisamit/nx7q9-vk42m-rp81t-z6core/issues/327). UI #265 remains OPEN. Real-world clinical/finance/device/DR gate #250 remains OPEN/NO_GO. Scope items may not be removed simply for scheduling.
