# F7 — password change: check current linked principal after bcrypt

## Risk

An active portal cookie is not sufficient authority to change credentials
after its linked patient/client/physician or organization is disabled or
reassigned. The password endpoint already locked the active portal account
and checked the current session, but while hashing a new password the
linked identity or tenant could become invalid. Changing the password
anyway would record a credential operation on a revoked portal principal.

## Correction

Inside the existing Serializable password transaction, after taking the
portal-account FOR UPDATE lock and before changing password hash, revoking
other sessions, or writing audit:

- lock/check an ACTIVE organization for the exact portal tenant;
- check the exact linked ACTIVE PATIENT, CORPORATE Client or PHYSICIAN
  Referrer, including matching organization and original linked ID;
- preserve the existing active-session check and password-change audit.

Invalid current linkage rolls back with the existing generic 401 response.
No inactive accounts can be reactivated. The original browser session
survival and other-session revocation policy are unchanged.

A source-level test checks all three account types, tenant and ordering.
An explicitly wired independent two-connection MariaDB test verifies that
an inactive linked patient, inactive organization, revoked session or
changed patient reference cannot rotate the password. Existing password
disable/session concurrency tests remain mandatory.

No schema migration, patient/financial history overwrite or result
amendment. Software tests are not rendered browser UAT or certification.
F7 private 486 UI cases, F8 88 qualified cases and seven signoffs remain
NOT_EXECUTED/NO_GO, and Hostinger SHA/device validation is unverified.
The Master Scope §§1–88 remains fully retained.
