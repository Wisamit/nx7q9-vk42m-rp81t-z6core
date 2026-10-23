# F8 §86 — Live tax publication authorization and concurrency (2026-10-23)

## Exact verified baseline

Merged PR #380 main `3fd364d06cfdc65efe679ebea7199f716992e159`; feature CI #40001299546 SUCCESS; **independent push main CI #40002521727 COMPLETED SUCCESS** on that exact main SHA. No open PRs at branch creation. `02_MASTER_SCOPE.md` full 88-section scope preserved.

## Confirmed financial software integrity gap

The tax publication route checked role, branch grants and active test/package **before** entering the tax-rule and audit transaction. Between preflight and the branch tax-version update, an administrator could revoke access, deactivate the service or retire a branch. The previous branch `updateMany` did not verify the number of affected rows; a zero-row update could still allow a tax rule to be inserted. This is a stale-authorization/TOCTOU defect rather than a request to invent tax rates.

## Fixed transaction boundary

- Retain fast preflight for responsive errors but **recheck current permission, active tenant/user, current live branch grants intersected with the original session scope** inside the publication transaction. Organization defaults require grants for every current ACTIVE branch.
- Lock ACTIVE organization row via `SELECT ... FOR UPDATE`; increment every affected branch `taxConfigVersion`, requiring the exact expected row count (1 for a specific branch or all active branches for an organization default). Drift raises a typed conflict and rolls back.
- Lock the ACTIVE, same-tenant test/package row via separate fixed parameterized `FOR UPDATE` SQL **before** inserting a versioned tax rule and an immutable audit event. Service retirement or source mismatch fails closed and rolls back branch versions.
- Reject revoked roles/scopes, inactive branches and retired or foreign services even if the original HTTP session's preflight was valid. No extra permissions or implicit clinical tax mapping.
- Preserve the source decimal-string tax rate, treatment/price mode checks, date versioning, unique scope/day constraint, issued invoice snapshots, originals, and append-only audit.
- Dedicated pure transaction-boundary tests and a real two-connection MariaDB version rollback/service lock test, wired to CI. Synthetic only, no PHI or private financial data.

## Not complete

This fixes a verifiable **software consistency defect** in §86; it does NOT establish any lawful jurisdictional tax policy, exemption, currency exchange, accountant approval or operational tax GO. §86 owner/accountant policy remains **BLOCKED_EXTERNAL**. §75 analyzer interference and §88 verified original MDB lineage still require qualified external inputs; §87 field-complete reviewed source activation is PARTIAL. Qualified F7 browser **0/486** and F8 real-world case acceptance **0/88**, seven independent GO signatures missing. **NO_GO**. No Hostinger deployment or device/restore evidence is claimed.

Release gate: latest exact feature HEAD complete CI SUCCESS, PR SHA equality, expected-head merge, then independent **push** main CI SUCCESS on actual merge SHA. Public-repository browser review stays skipped to protect data.
