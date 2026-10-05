# Family Lab LIS — Production Readiness Checklist

This checklist is the final release gate for a production or controlled pilot deployment.

## 1. Build and database

- [ ] CI passes on the release commit.
- [ ] All Prisma migrations deploy successfully against MariaDB.
- [ ] `prisma migrate status` reports no failed or pending migration.
- [ ] Production database backup is taken before deployment.
- [ ] Restore procedure is tested against a non-production database.
- [ ] Production `DATABASE_URL` points to the intended database and uses a restricted application account.
- [ ] Database timezone/storage conventions are verified.

## 2. Security

- [ ] `APP_ENCRYPTION_KEY` is configured with a production secret.
- [ ] Staff administrator accounts use MFA.
- [ ] Default/setup credentials have been changed or disabled.
- [ ] HTTPS is enforced.
- [ ] Security headers are present in production.
- [ ] Authentication rate limiting is working.
- [ ] Integration API keys are scoped, expiring where appropriate, and stored only once at creation.
- [ ] Webhook/integration secrets are stored in environment configuration, not database plaintext.
- [ ] Staff and portal permission reviews are complete.

## 3. Organization and branches

- [ ] Organization master data is correct.
- [ ] Every operational branch is configured and active.
- [ ] Users have only the required branch scopes.
- [ ] Active-branch switching is tested for multi-branch users.
- [ ] Cross-branch access attempts are rejected.
- [ ] Inter-branch specimen transfer manifests and chain-of-custody are tested.

## 4. Patient identity

- [ ] Patient number generation is validated.
- [ ] Duplicate-patient detection workflow is tested.
- [ ] Patient search does not expose unauthorized branch-linked operational records.
- [ ] Patient identity is shared organization-wide as designed.

## 5. Test catalog and clinical configuration

- [ ] Production test catalog has been reviewed.
- [ ] Panels/profiles and commercial packages are reviewed separately.
- [ ] Units and methods are correct.
- [ ] Specimen/container requirements are correct.
- [ ] Effective-dated reference intervals are loaded and reviewed.
- [ ] Critical limits are reviewed by authorized laboratory staff.
- [ ] Ask-at-order questions are reviewed.
- [ ] LOINC/local terminology mappings are reviewed where used.
- [ ] Historical values remain snapshot-based and unaffected by later catalog changes.

## 6. Pricing and billing

- [ ] Organization default price lists are reviewed.
- [ ] Branch/client/contract overrides are reviewed.
- [ ] Pricing precedence is confirmed: CONTRACT > CLIENT > BRANCH > ORGANIZATION.
- [ ] Currencies are explicit and never mixed into one total.
- [ ] Test/package price snapshots are verified on historical orders/invoices.
- [ ] Partial payments and payment allocations are tested.
- [ ] Void/cancel behavior is tested without deleting financial history.
- [ ] Send-out laboratory costs use explicit currency.

## 7. Specimens

- [ ] Barcode generation and scanner workflow are tested.
- [ ] Collection requires configured specimen type.
- [ ] Receive workflow accepts only valid specimen states.
- [ ] Rejection requires a reason and creates traceable recollection.
- [ ] Chain-of-custody events are visible and audited.
- [ ] Transfer receipt at destination branch is tested.
- [ ] Sample identification never relies on patient name alone.

## 8. Results and release

- [ ] Manual result entry is tested.
- [ ] Analyzer result import is tested for each production analyzer/interface.
- [ ] Reference ranges and flags are verified.
- [ ] Calculated results are verified.
- [ ] Delta checks are verified.
- [ ] Reflex rules are reviewed.
- [ ] Validation holds are reviewed.
- [ ] Autoverification policies are reviewed before enabling.
- [ ] Analyzer QC WARN prevents autoverification and requires review.
- [ ] Analyzer QC BLOCK prevents release.
- [ ] Critical results require acknowledgement/communication before release.
- [ ] Released results cannot be overwritten.
- [ ] Amendment workflow creates a new version and preserves the released original.
- [ ] Repeat/rerun markers are traceable.

## 9. Microbiology

- [ ] Culture workflow is tested end to end.
- [ ] Organisms and antibiotic catalog are reviewed.
- [ ] Susceptibility results and interpretation are reviewed.
- [ ] Microbiology finalization and report rendering are tested.
- [ ] Dedicated microbiology amendment policy is understood by users.

## 10. QC and equipment

- [ ] Equipment belongs to the correct branch.
- [ ] Calibration due/fail/in-progress states block where required.
- [ ] Downtime handling is tested.
- [ ] QC lots, targets and validity windows are reviewed.
- [ ] Westgard rule handling is reviewed.
- [ ] QC violations, corrective actions and resolution are tested.

## 11. Quality management

- [ ] Nonconformance workflow is tested.
- [ ] CAPA workflow is tested.
- [ ] SOP/document version lifecycle is tested.
- [ ] Training and competency due dates are reviewed.
- [ ] Analyzer authorization records are reviewed.
- [ ] Quality indicators are configured.
- [ ] Internal audit workflow is tested.

## 12. Reports and notifications

- [ ] Production report template version is activated.
- [ ] Arabic and English report presentation is reviewed.
- [ ] QR verification works from the public verification endpoint.
- [ ] Partial/final/amended report labels are correct.
- [ ] Report delivery logging is tested.
- [ ] Notification templates are reviewed.
- [ ] Email/SMS/WhatsApp providers are tested if enabled.
- [ ] Retry/dead-letter behavior is visible to operators.

## 13. External integrations

- [ ] HL7/FHIR/API endpoints expose only authorized organization/branch data.
- [ ] Inbound HL7 idempotency is tested.
- [ ] Outbound report integration retries are tested.
- [ ] Webhook destinations use HTTPS.
- [ ] Integration failures do not modify released clinical history.
- [ ] Hospital/clinic interface mappings are validated with the receiving party.

## 14. Inventory and send-out work

- [ ] Inventory balances are reconciled before go-live.
- [ ] Lots and expiry dates are correct.
- [ ] Consumption workflow is tested.
- [ ] External/referral laboratory masters are reviewed.
- [ ] Send-out dispatch, result receipt and verification are tested.
- [ ] Secure attachment upload/download authorization is tested.

## 15. Resilience and operations

- [ ] Health readiness endpoint is monitored.
- [ ] Backup freshness is monitored.
- [ ] RPO/RTO targets are approved.
- [ ] Disaster recovery drill is recorded.
- [ ] Retention policies are reviewed.
- [ ] Clinical/report/audit history remains retain-only.
- [ ] Offline clinical writes remain disabled unless a separately approved safe design is implemented.
- [ ] Edge/buffered events are limited to approved non-clinical event types.
- [ ] Performance is tested with representative production data volume.

## 16. Pilot acceptance

- [ ] Reception completes patient → order → payment workflow.
- [ ] Phlebotomy completes barcode → collect → receive workflow.
- [ ] Laboratory completes worklist → result → verify → release workflow.
- [ ] Critical-result scenario is demonstrated.
- [ ] Amendment scenario is demonstrated.
- [ ] Inter-branch transfer scenario is demonstrated.
- [ ] Analyzer/QC scenario is demonstrated.
- [ ] Billing reconciliation is approved.
- [ ] Management analytics are reviewed.
- [ ] Quality manager signs off QMS workflows.
- [ ] Authorized business owner approves go-live.

## Automated release gates

The repository CI must pass:

1. MariaDB migration deployment
2. Prisma client generation
3. Critical LIS safety policy tests
4. TypeScript compilation
5. ESLint

Passing CI is necessary but not sufficient for clinical production approval. The operational checklist above requires human validation with production configuration and representative workflows.
