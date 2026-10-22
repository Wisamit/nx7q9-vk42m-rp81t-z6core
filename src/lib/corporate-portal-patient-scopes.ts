/**
 * Derive read and mutation scopes from already tenant-scoped, active,
 * effective-dated corporate patient grants.
 *
 * Permission to BOOK must not grant access to clinical orders or tests.
 * Existing report permission is the only currently modeled clinical
 * read capability for corporate portal patients.
 */
export function corporatePortalPatientScopes(
  grants: ReadonlyArray<{
    patientId: string;
    canBook: boolean;
    canViewReports: boolean;
  }>,
) {
  const booking = new Set<string>();
  const clinicalRead = new Set<string>();
  for (const grant of grants) {
    if (grant.canBook) booking.add(grant.patientId);
    if (grant.canViewReports) clinicalRead.add(grant.patientId);
  }
  return {
    bookingPatientIds: [...booking],
    reportPatientIds: [...clinicalRead],
    appointmentPatientIds: [...new Set([...booking, ...clinicalRead])],
  };
}
