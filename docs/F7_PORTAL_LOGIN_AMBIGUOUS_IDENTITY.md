# F7 portal login — ambiguous tenant identity rejection

## Defect

Portal login previously queried by organization code and either normalized
email or normalized phone using `portalAccount.findFirst`. Both contacts are
indexed, but neither is unique per tenant. Duplicate contacts within one
organization or an email/phone cross-match can therefore select an arbitrary
portal account; outcome depends on storage order rather than identity proof.

## Remediation

The login query now fetches at most two matching accounts in the **requested
active organization**, using the same normalized login criteria. A login
proceeds only when **exactly one** account matches. Zero or multiple matches
return the preexisting generic `invalid_credentials` 401 response.

- This prevents selecting another patient, referrer or client portal identity
  based on unordered `findFirst` results.
- It does not reveal whether an account, duplicate identity or tenant exists.
- It does not silently prefer an active account over a disabled conflicting
  identity; that contact ownership conflict needs administrative resolution.
- Existing bcrypt, account lockout, MFA/contact checks, session row locking,
  session creation, tenant scoping and audit behavior are retained.
- No retroactive uniqueness migration is imposed on legacy accounts, and no
  clinical, billing or released report history is rewritten.

## Engineering verification

The safety test checks fail-closed selection before password comparison.
A separately wired GitHub CI test uses real MariaDB fixture accounts to verify
same-tenant duplicate-email and cross-field collisions, tenant isolation,
resolution of an ambiguity, disabled-duplicate denial, and inactive-tenant
denial. Synthetic example.invalid contacts and temporary organizations are
deleted in cleanup.

F7 81 routes x 6 private rendered/interactive contexts remain
UAT_DEFERRED / NOT_EXECUTED. F8 88 qualified cases and seven external
signoffs remain NOT_EXECUTED / NO_GO. No Hostinger deployment, clinical,
tax, analyzer or disaster-recovery approval is inferred. Master Scope
sections 1–88 remain unchanged.
