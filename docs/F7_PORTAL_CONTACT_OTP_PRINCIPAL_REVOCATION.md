# F7 — revoke OTP contact verification for inactive portal subjects

## Defect

The portal booking, clinical dashboard and doctor requisition paths already
require an ACTIVE linked subject in the portal account's own organization.
The contact verification request and verify routes still validated only
an active portal account/session and did not enforce a live patient, client
or physician link. A stale portal session could send or register OTP contact
proof after the associated Patient was merged or deactivated, a corporate
Client was deactivated, or a physician/Referrer ceased to be active.

## Implementation

`hasLivePortalContactPrincipal(account)` reuses the shared already-tested
patient/corporate identity and physician linkage checks. For every OTP
request and OTP code verification, before parsing the request payload or
reading/writing challenge records:
- PATIENT requires exact linked ACTIVE patient in the same organization.
- CORPORATE requires exact linked ACTIVE client in the same organization.
- DOCTOR requires exact linked ACTIVE PHYSICIAN referrer in same organization.
- Unknown/missing/mismatched/merged/deactivated links fail closed with 401.

This preserves OTP per-account serialization, atomic retry budget,
single-use, destination matching, notifications and audit data. It does
not change the invitation flow or any physical patient/clinical data.

Automated negative tests cover every type, stale or foreign links and the
guard ordering on the two actual API routes. No database migration.

F7 protected browser matrix 81×6 remains NOT_EXECUTED, F8 qualified
88-case/seven-signoff review remains NOT_EXECUTED / NO_GO.
No Hostinger release verification or clinical approval is implied.
Master Scope §§1–88 is retained without reduction.
