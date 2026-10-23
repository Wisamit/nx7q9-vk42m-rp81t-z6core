# F7 — live account, linked subject and session locks for OTP verification

## Defect

An OTP verification request validates the linked patient/client/physician at HTTP entry, then performs bcrypt comparison outside a transaction. The account, linked subject or portal session may be disabled/revoked or reassigned before the OTP is claimed. Earlier code used a challenge CAS but did not revalidate that the caller remained authorized **at claim time**.

A stale cookie and previously read six-digit code therefore could record contact verification proof after revocation.

## Engineering correction

Inside the existing OTP verification transaction, before consuming the challenge or creating verification/audit records:

- A SELECT ... FOR UPDATE query locks the live portal account together with its linked Patient, Client or PHYSICIAN Referrer. Requires ACTIVE status, exact tenant context, and no forced-password-change flag.
- The current account email/phone must match the verified destination.
- A second SELECT ... FOR UPDATE checks the exact initiating portal session, revocation and expiry.
- The final portalAccount.updateMany independently requires ACTIVE status, organization ID, and mustChangePassword=false.
- Stale account/subject or session returns generic 401 and rolls the transaction back; destination changes return 409.
- Previous OTP expiry/attempt/single-use compare-and-set remains in place.

New assertions require these locks and their ordering before consuming the OTP and writing contact proof. A mandatory two-connection MariaDB integration test checks linked patient deactivation during an OTP transaction's subject lock, subsequent revocation denial, revoked session denial and disabled account denial.

This is synthetic engineering evidence, not a real penetration test. No schema change or released clinical/financial history rewrite.

## Acceptance limits

Master Scope §§1–88 preserved. F7 private browser acceptance 0/486 is NOT_EXECUTED. F8 88 qualified real-world cases and seven approvals remain NOT_EXECUTED / NO_GO. Hostinger, analyzer devices, DR and medical/financial approvals remain unverified.
