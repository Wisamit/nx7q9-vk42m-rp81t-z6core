# Stage 112 — Historical promised report delivery at order registration

**Base:** main `7e74212aca473d227b9d948cd54f88ab982f7beb`; Stage 111 confirmed deployed successfully by owner; CI #1223 SUCCESS.

## Verified gap and provenance

- `02_MASTER_SCOPE.md` §§14 (orders), 67 (TAT), 73 (localization), 80 (historical integrity), plus `03_LEGACY_ACCESS_ANALYSIS.md` and the Access `Deleveary` field/workflow described in `docs/DEEP_SYSTEM_AUDIT_2026-10-06.md`.
- Latest main provides effective-dated per-test TAT policies/snapshots, but **no separate staff-entered, patient-promised report delivery date/time** on a registered order. Patient commitments must not be invented from laboratory TAT or changed when branch settings subsequently change.

## Implementation

1. Backward-compatible, nullable columns on `orders`: `promised_report_delivery_at_utc` (DATETIME(3)), `promised_report_delivery_local` (VARCHAR(16)) and `promised_report_delivery_timezone` (VARCHAR(64)). Migration `20261013184000_order_promised_report_delivery_snapshot`. Existing orders retain null fields rather than fabricated delivery promises.
2. Registration permits an optional staff-entered `YYYY-MM-DDTHH:mm` in the selected **ordering branch** local timezone, explicitly labelled in the Arabic/English order form and branch selector. Branch timezone is resolved server-side, never trusted from browser input.
3. Server validates strict local date/clock, valid IANA timezone, future time and DST gaps/folds; rejects malformed, past and ambiguous instants without silently choosing a UTC offset. The branch configuration revision check includes unchanged timezone while registration is committed.
4. The UTC instant, exact local entry and timezone are all frozen in the new order, in the registration audit record, and reported in the creation response. Order detail displays both the local and UTC snapshot. No updates to previously registered delivery commitments have been enabled.
5. This is an **operational patient promise**, **not** an automatic clinical due date, QC release override, patient notification trigger, billing entitlement or analyzer deadline. Current TAT and result validation remain unchanged.
6. No new external provider setup, automatic patient messages, physical test/device activation or clinical report release.

## Acceptance

- [ ] Feature exact SHA CI SUCCESS: full safety, MariaDB real integration, Prisma migrations, TypeScript, lint, RTL/i18n, Next production build.
- [ ] PR Ready and merged with expected HEAD SHA.
- [ ] Independent main CI SUCCESS at exact merge SHA.
- [ ] Owner confirms Hostinger deployment separately; do not equate CI success with production deployment.
- [ ] Real clinic staffing, patient promises, branch working hours/calendar holidays, legacy MDB historical date mapping, clinical and manual UAT **DEFERRED** until final LIS acceptance.
