# F7 portal booking mode — explicit validation

Previously the portal appointment POST silently interpreted every value except
the exact string HOME_COLLECTION as ONSITE. An explicit misspelling or an
unexpected integration payload could therefore turn a requested
home-collection visit into an onsite appointment, omit home-visit scheduling
and produce misleading booking acknowledgments.

The new portalBookingMode boundary accepts exactly ONSITE and HOME_COLLECTION,
plus the original legacy default when the field is absent, null or empty.
Unexpected explicit values fail with HTTP 400 invalid_booking_request before
any appointment creation, home-collection visit or audit mutation.

The original same-key UUID, MariaDB unique constraint, branch-local time
validation and minimal 201/replay 200 response remain unchanged.
Pure boundary tests cover valid, missing and malformed mode values; source
tests ensure validation precedes intent hashing and appointment transaction.
The portal HTTP client still distinguishes documented 400 rejection from
uncertain proxy/network outcomes.

No database schema, order, invoice, specimen, released result, audit history
or active tariff is rewritten.

F7 interactive/browser review remains NOT_EXECUTED (81 routes x 6),
and all 88 real-world F8 cases/seven signoffs remain NOT_EXECUTED / NO_GO.
Master Scope sections 1–88 remain in force; no production deployment or
clinical qualification is inferred from this software test.
