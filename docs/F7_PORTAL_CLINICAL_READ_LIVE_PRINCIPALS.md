# F7 — live patient/client authorization before portal clinical reads

## Risk addressed
The F7 booking POST already rejected a patient portal account with no linked,
ACTIVE same-tenant Patient and a corporate account with no linked, ACTIVE
same-tenant Client. However the **server-rendered portal dashboard** and
**diagnostic report version detail** relied only on cached
`portalAccount.patientId` or `portalAccount.clientId` from an active session.
This could leave clinical order, report or invoice data accessible after the
associated patient was merged/inactivated or the corporate client was
deactivated or reassigned. A still-active login is not equivalent to a
currently authorized patient/client principal.

## Correction
Both portal server pages now apply the already-tested
`resolvePortalBookingActor(account)` guard before any sensitive
clinical/financial query. Non-DOCTOR principals must have an exact linked ID,
matching organization ID and ACTIVE linked Patient/Client. Invalid links
fail closed via `notFound()`. The existing DOCTOR referrer guard remains
separate and unchanged.

- No new permission, migration or data mutation
- Corporate canViewReports, booking grants and client order constraints remain
- Doctor per-patient grant checks remain
- Retracted/amended report behavior and report delivery audit remain
- Patient orders, invoice totals, specimen and test history are not modified

Pure negative cases and source-order regressions confirm deactivated,
merged, missing, mismatched and foreign patient/client links cannot enter
clinical report or invoice read queries. The shared session must continue
loading the linked Patient and Client and checking the tenant.

## Acceptance limitations
This is an **automated authorization-source regression**, not rendered
browser, qualified medical, privacy, finance or device acceptance.
F7 486 private browser combinations remain NOT_EXECUTED / UAT_DEFERRED.
F8 88 real-world sections, seven qualified signoffs and Hostinger deployment
remain NOT_EXECUTED / NO_GO. Master Scope §§1–88 is unchanged.
