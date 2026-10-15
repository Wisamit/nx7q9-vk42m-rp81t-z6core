# Stage 128 — Analyzer, interoperability, provider messaging and delivery

## Scope and evidence (2026-10-15)

Base is owner-confirmed deployed main 668a8bfb7121b7daa461a259d7d03fe2276f4b8d (Stage 127).
The source of truth is Master Scope §§29, 31, 32, 45, 46, 47, 48, 74 and 76. This stage closes identified software gaps without mislabeling vendor, provider or clinical acceptance.

| Section | Existing software and Stage 128 evidence | Unverified external dependency |
| --- | --- | --- |
| 29 Referral/send-out laboratories | Existing reference-lab order, sample, expense and received-result workflow retained | Contract, real reference-lab handoff |
| 31 Analyzer integration | Stage 108 inbound HL7 v2 MLLP, ASTM E1381/E1394 and original raw message; new mock MLLP AA/AR queue test | Live instrument/vendor qualification |
| 32 Bidirectional analyzers | Stage 109 file-handoff and signed lease replay, plus Stage 128 outbound HL7 MSA control-ID/code validation and attempt fingerprint | Instrument-specific outbound wire adapter/ACK |
| 45 Delivery | Current-version report status and no obsolete-link dispatch, new provider delivery/bounce evidence | Actual email/SMS/WhatsApp delivery |
| 46 Patient portal | Existing credential/identity and report-version access reused | Patient OTP and identity UAT |
| 47 Doctor portal | Existing explicit patient/doctor scope grants and requisition intake reused | Doctor consent and operational UAT |
| 48 Corporate portal | Existing client/contract restrictions reused | Real corporate partner/privacy review |
| 74 Notifications | Existing fenced retries/idempotency keys and new signed callbacks with tenant/channel binding | Provider credentials and receipt integration |
| 76 API/interoperability | Existing API keys, FHIR R4 reads, HL7 inbound/outbound, webhooks and terminology; replay-hardening | External partner mapping validation |

## Signed external provider receipts

- Gateway callback: POST /api/notifications/provider-receipt, JSON only, max 8192 UTF-8 bytes, authenticated by timestamp x-family-lab-timestamp (Unix seconds, 10 digits, ±300 seconds) and x-family-lab-signature (sha256= plus hex digest).
- Body must contain exactly organizationId, deliveryId, channel, providerMessageId, receiptId and status. Channels: EMAIL/SMS/WHATSAPP; statuses: DELIVERED/FAILED.
- Compute per-tenant/channel HMAC key as HMAC_SHA256(master, the UTF-8 string familylab-provider:organizationId:channel). Sign timestamp + "." + exact raw request body using that binary derived key. Keep NOTIFICATION_RECEIPT_MASTER_SECRET exclusively on the LIS host and share ONLY derived individual tenant/channel credentials with approved gateways. Use a separate high-entropy secret on production. NEVER commit real keys.
- An authentic receipt binds to tenant, notification delivery, channel and the message ID retained from provider success. Replayed identical receipt fingerprint is accepted without a second audit; conflicting receipts and receipts for another tenant/provider are rejected. Failed delivery is terminal and staff reconciliation is required rather than unsafe resend.
- A report delivery event is DELIVERED only when the provider confirms delivery; an HTTP success is merely SENT. A synchronous gateway DELIVERED response also requires a provider message ID. All callbacks re-check current non-retracted report version before confirming linked delivery. Confirmation does not edit released results.
- Gateway must honor stable Idempotency-Key across network retries. Delivery receipts identify a provider disposition, not evidence a patient read a report.

## HL7 outbound ACK

- Consumer bound to the registered integration endpoint and messages.ack permission, same original attempt.
- When supplied, raw HL7 ACK must have MSH and exactly one MSA with original control ID and matching AA/AE/AR code. Fingerprint stores the exact attempt, code, payload and error, and allows only byte-identical idempotent repeats. A code-only legacy receipt is transport attestation, NOT a proven vendor wire ACK.
- Synthetic AA, AE, AR, mismatched control IDs and reply timeouts are acceptance tests. Existing ASTM transport intentionally does not claim vendor-specific handshake support.

## Release and acceptance limits

- Additive migration 20261015102500_provider_receipts_and_hl7_ack_replay adds enum DELIVERED, optional delivered_at, receipt_fingerprint, ack_fingerprint. No historical reports, results, prices or patient data are rewritten.
- Acceptance automation: mock MLLP positive/negative frames; signed callback verification and ACK mismatch tests; MariaDB three connections/two competing workers checking exactly-one CAS, tenant isolation and immutable replay. Existing analyzer, portals, report, notification and interoperability suites remain in CI.
- Draft legacy PR #128 and #209 are deliberately not merged. Later physical analyzer, SMTP/SMS/WhatsApp, partner data and human clinical/privacy approval remain Stage 132.
- Hostinger operator performs a DB backup BEFORE deploy/build because package.json build executes Prisma migrations. Do not enable any gateway or instrument without approved specification and keys.
