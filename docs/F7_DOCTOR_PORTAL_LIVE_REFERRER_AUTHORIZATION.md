# F7 doctor requisitions — live physician linkage gate

## Reason

Doctor-requisition POST checks an active PHYSICIAN Referrer and same-tenant
organization in its MariaDB transaction. However, the shared authorization
helper used by GET, POST and PATCH previously verified only a DOCTOR portal
account with a non-null referrerId. A retained session whose referrer was
later deactivated or otherwise mismatched could still access historical
requisitions or submit cancellation requests. Authorization must not depend
on an obsolete FK alone.

## Change

`hasLiveDoctorPortalReferrer` requires a linked Referrer matching the
portal account referrerId, ACTIVE status, PHYSICIAN type and exact
organizationId. All three requisition HTTP methods pass the same guard
before reading request data or opening DB operations; invalid sessions
receive the pre-existing generic doctor_portal_unauthorized 403. Existing
per-patient grants, request idempotency, transactional physician locks,
patient/branch checks, audit history and historical requisitions are retained.

Synthetic tests cover active, inactive, missing, mismatched, foreign-tenant,
non-physician and non-doctor principal; route wiring confirms GET/POST/PATCH
share the guard and that the existing active grant and DB physician lock
remain present.

No database migration, released result/history mutation, permission
expansion or go-live claim.

F7 protected browser review 81 routes x 6 contexts is NOT_EXECUTED;
F8 88 qualified real-world cases and seven signoffs are NOT_EXECUTED/NO_GO.
Master Scope sections 1–88 remain mandatory.

## Server-rendered clinical disclosure paths

The same guard also executes on the authenticated doctor dashboard and the
individual released-report detail page before loading clinical order/report
data. A disabled or reassigned physician cannot retain clinical report-list
or report-detail access merely by keeping an otherwise active portal cookie.
The UI fails closed through `notFound()` without revealing report content.
All preexisting explicit per-patient doctor grants still apply once the
principal passes the link check.

This is source/runtime guard testing, NOT final live-role, browser or medical
acceptance. The qualified F7/F8 gates remain deferred.
