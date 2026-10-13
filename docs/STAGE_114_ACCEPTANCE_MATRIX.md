# Stage 114 — Staff-attested in-person report handover, append-only and branch-controlled

## Base and verified gap

- Base `main` SHA: `8a3d079a54040778a278d7363f6e6e1f97c44cd0`, Stage 113 owner-confirmed successfully deployed to Hostinger. Independent main CI #1229: SUCCESS.
- `02_MASTER_SCOPE.md` §45 requires report delivery channels and delivery logs; §64 electronic approval and §80 preserved report history apply.
- Existing report delivery API accepts only browser `PRINT` or `DOWNLOAD` / `RECORDED` events; outbound notifications have their own trusted provider delivery evidence. No authenticated, separate in-person staff handover workflow was present.
- **This is strictly staff attestation**, not patient-signed acknowledgment, physical printer proof, external delivery confirmation, or a clinically releasable event.

## Implementation

1. New staff-facing bilingual report handover form on current `FINAL` or `AMENDED` reports; disabled for `PARTIAL`, `RETRACTED`, older/superseded versions and staff without `reports.deliver`.
2. Staff must type the exact patient number **from the immutable report version snapshot** (never mutable current patient demographics), indicate the identity-check method (`PHOTO_ID_AND_PATIENT_NUMBER` or `TWO_PATIENT_IDENTIFIERS`), and affirm in-person handing to the **patient**. No ID/document numbers may be submitted or stored. Representative handover intentionally requires future explicit policy and authorization verification.
3. Server enforces tenant membership, `reports.deliver`, permitted and **active ordering branch**, latest report version and eligible final status. The report parent row is locked in a transaction before version re-check and append-only record creation. Existing released observations, report PDF snapshots and earlier delivery events are untouched.
4. Append-only `ReportDeliveryEvent` uses `OTHER/RECORDED` with `STAFF_ATTESTED_IN_PERSON_HANDOVER_V1`, protected identity-check metadata and `independentPatientAcknowledgement:false`. This deliberately avoids misleading `DELIVERED` status (reserved for independently evidenced trusted channels). An `AuditEvent` logs exact report version, branch, actor, identity-check method and event identifier, without patient number or ID documents.
5. Unique nullable `handover_request_id` on the delivery event, with a deterministic SHA-256 fingerprint of the original payload/version. Identical retries from same staff member return existing event without a second audit entry; changed body/actor/version with the same key is rejected. Concurrency enforced by MariaDB uniqueness.
6. The current report's delivery history distinguishes staff attestation with an explicit warning that patient receipt was **not independently verified**. On network failure the browser retains the same request key for safe replay.
7. Migration `20261013191000_staff_attested_report_handover_idempotency` adds nullable unique key; no backfill or alteration of prior clinical or delivery events. No external transport, SMS/WhatsApp/email delivery, portal, automatic notification or physical device is enabled.

## Acceptance gates

- [ ] Exact feature-head CI: full safety, MariaDB including concurrent uniqueness and withdrawal, Prisma migrate, TypeScript, ESLint, RTL/i18n, Next build — SUCCESS.
- [ ] PR reviewed, marked Ready and merged with expected feature-head SHA.
- [ ] Independent `main` CI SUCCESS on merge SHA before owner Hostinger publication.
- [ ] Owner backup, additive migration, Hostinger deployment and confirmation separately recorded.
- [ ] Clinical identity-verification policy, real patient handover, signature/receipt compliance, real-world branch staff permissions, security review and recovery evidence **DEFERRED** until complete LIS acceptance, never claimed passed.

## Explicit limitations

- A staff click is an **attestation**, not independent legal proof of receipt. For that reason the event has `RECORDED` status and a descriptive evidence type, **not** `DELIVERED`.
- Future support for authorized representatives requires a verified authorization chain and separate approval; this phase does not silently allow it.
