# F7 corporate portal clinical-read authorization boundary

## Source defect

The corporate portal Orders & Status table previously selected patients
granted canBook OR canViewReports. Corporate accounts granted only canBook
could consequently see test codes, accession numbers, order statuses and
patient identifiers, although canViewReports remained false.

A booking-only grant is not a clinical order/report read grant.

## Code correction

The already current-client, ACTIVE and effective-dated grants now yield three
independent patient ID sets:

- bookingPatientIds: canBook, for new appointment forms.
- reportPatientIds: canViewReports, for report AND clinical order lists.
- appointmentPatientIds: union of the grants, further constrained to the
  current portalAccountId for this account's own appointment list.

No global query fallback, no cross-tenant mixing and no default permission.
An empty report scope filters to no clinical orders. Booking-only users can
still book and see their own previously booked appointments.

A deterministic synthetic regression covers canBook-only, report-only, both,
neither, repeated grants and missing grants, plus source assertions on the
actual portal query and current-client/effective-date filters.

This correction is software/source-level evidence only. Human F7 browser
and role-based UAT (81 routes x six contexts), all 88 qualified F8 cases,
seven signoffs, Hostinger deployment, analyzer and clinical/financial
qualification remain NOT_EXECUTED / NO_GO. All Master Scope sections 1–88
remain unchanged.
