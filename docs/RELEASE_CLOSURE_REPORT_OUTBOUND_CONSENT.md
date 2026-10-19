# Family Lab — final report outbound consent and recipient integrity closure

**Hostinger baseline confirmed by owner:** `86a1b8177b03571876e35417aaba1d316e67a00d`. This P1 privacy correction is within frozen release scope, not an additional feature or a numbered Stage.

## Source-confirmed privacy gap

Existing `POST /api/reports/[versionId]/outbound` validated a portal account, destination-bound EMAIL/PHONE verification, and corporate per-patient report grant **before** starting its transaction. It rechecked the current report version inside the transaction, but not the currently authorized recipient/destination. Thus an authorization revocation between preflight and queue could leave a pending secure report notification despite the revocation.

The separate `dispatchPendingNotifications` worker already checked for report amendment/retraction but did **not** revalidate recipient portal account, current destination-bound contact verification, or corporate patient report access immediately before the external provider request. A previously queued report link could be sent after the portal account or grant was disabled.

External messages contain an authenticated portal link rather than the numerical result, but can include patient name/accession and still expose confidential lab context; this remains a P1 privacy breach risk.

## Consolidated protection

- New `currentReportRecipientAuthorized` policy: tenant and recipient-identity scoped; checks expected portal type, currently ACTIVE account, exact current destination and unrevoked destination-bound verification; for CLIENT additionally requires currently active, effective, patient-specific `canViewReports` grant.
- At enqueue-time inside the report-version lock transaction, obtain InnoDB `FOR UPDATE` locks on account, relevant portal verification rows, and (for corporate recipients) active corporate grant rows before creating `ReportDeliveryEvent`, notification and audit. A stale preflight or contact revocation fails closed with HTTP 409 `report_recipient_authorization_changed`.
- At notification dispatcher time, once a claim is held and report version has been checked, independently re-read recipient account/verification and corporate grant. Revoked, disabled or modified destination skips delivery (`SKIPPED`; report delivery event `FAILED`) rather than calling the external gateway.
- Arabic/English UI explicitly states that no report notification was queued after a recipient authorization change.
- No PDF/report revision mutation, clinical values, migrations, schema, financial history, provider API, or dependency changes. Existing idempotency and retry rules are preserved.

**Race boundary:** This prevents known revocations committed before enqueue's locked authorization or send-time check. It cannot retract a provider request already in flight if a staff member revokes consent after the outbound eligibility check; real operational policies and UAT must cover that irreversible boundary. Browser/client-side PDF and paper handover are out of scope.

## Evidence and remaining release gates

- `tests/release-closure-report-outbound-authorization.test.ts`: direct policy tests for inactive account, revoked verification, identity mismatch, destination changed, missing client grant, queue-lock ordering and send-before-provider fail-closed source contracts.
- `tests/release-closure-report-outbound-consent-mariadb.integration.test.ts`: isolated synthetic organization/patient/client/account/verification/access records. Real MariaDB competing transactions prove verification and corporate grant revocation serialize with locking current authorization; cleanup isolates all fixtures.
- CI runs the new MariaDB regression plus existing report-outbound and safety tests, TS, ESLint, 88-scope static inventory, 81-route static UI inventory, and Next production build. **Source inventory and green CI are not interactive acceptance.**
- **Issue #265 remains OPEN:** private synthetic 81-screen authenticated interactive RTL/LTR/role/visual/accessibility browser review; public GitHub does not capture sensitive screenshots.
- **Issue #250 remains OPEN / NO_GO:** complete 88 real-world UAT cases and owner medical, finance, quality, analyzer/device and DR signoffs, legacy Access MDB reconciliation and governed Master Scope §§75, 86, 87, 88.
- Independent owner confirmation required for exact Hostinger deployed SHA. No clinical Production GO or final Software RC solely on this fix.
