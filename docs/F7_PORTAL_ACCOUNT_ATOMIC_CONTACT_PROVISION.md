# F7 portal account provisioning — atomic contact ownership

## Defect

The portal account provisioning API checked whether a normalized email or
phone number was already assigned in the same organization before entering
its create transaction. Without database-level unique contact constraints
(legacy-compatible indexed fields), two parallel POSTs could both observe
no existing owner and each create an account using the same identity.

## Correction

The API now opens a Serializable transaction, locks the ACTIVE organization
row with SELECT ... FOR UPDATE, checks both normalized contact identifiers
under that lock, then creates the portal account and its audit record.
All provisioning requests in the same tenant acquire the same parent lock;
the second request sees the first committed contact and returns the existing
portal_contact_already_in_use HTTP 409. The organization status is checked
again under the lock and deactivated organizations cannot provision accounts.

The check is transaction-scoped, not a best-effort pre-read. No schema-level
unique constraint is imposed on legacy data, no current portal account or
contact is silently renamed/deleted, and no historical clinical or finance
record is rewritten.

## CI evidence

A source regression enforces lock -> duplicate check -> create -> audit
ordering. An explicit GitHub Actions test uses two physical MariaDB
connections and simultaneous provisioning to prove that only one of two
same-tenant attempts succeeds, while the same contact may be independently
used in a separate tenant. Deactivated tenant creation is rejected.

This does not imply all existing legacy contact collisions are remediated;
duplicate historical contacts must be reviewed separately. F7 protected
browser UAT 486 combinations remains NOT_EXECUTED, and F8 88 real-world
cases plus seven approvals remain NOT_EXECUTED / NO_GO. Hostinger deployment,
physical analyzers, financial signoffs and clinical validation remain
unverified. Master Scope sections 1–88 are preserved.
