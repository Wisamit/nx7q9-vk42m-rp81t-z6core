# Stage 109 — Durable outbound analyzer handoff and ACK replay integrity

**Base:** `main` `22d2f78f93b90b49593ce7c1183e4d698091e205`; Stage 108 owner-confirmed deployed to Hostinger; CI #1211 SUCCESS.  
**Target:** `02_MASTER_SCOPE.md` §§31–32 and §77; do not confuse software readiness with commissioned physical instruments.

## Verified source gap

The LIS already has branch- and credential-scoped work-order routing and claim/ACK API (Stage 10), while Stage 108 added inbound MLLP/ASTM/HL7 raw import bridge. The Bridge lacked an outbound work-order consumer, a durable device handoff boundary, a receipt relay and retry-safe acknowledgement provenance. Physical transport and vendor interpretations are **not** silently assumed.

## Engineering change

1. `bridge/outbound-worker.mjs` is an **explicitly opt-in**, standalone Node process that claims at most one order at a time. It validates that the bridgeDeviceKey belongs to the approved local analyzer configuration; saves the immutable order/barcode/analyzer-code envelope and cryptographic lease to a local durable, restricted `.claim.json` file. This is a **queued handoff, not sent to a device**.
2. An independent vendor-approved adapter must atomically put a matching `.receipt.json` into the designated ACL-protected directory, with disposition `ACCEPTED`, `RETRY` or `REJECTED`. An `ACCEPTED` receipt requires the **exact wire message** that adapter attests to transmitting. The worker does not generate guessed HL7/ASTM outbound messages or fake a physical ACK.
3. The worker verifies attempt ID, device key, active lease and receipt shape; posts the original lease token and wire evidence back to the authenticated LIS endpoint. Local `.done` evidence is fsynced before archiving the pending/receipt records. An interrupted ACK can be replayed identically without retransmitting a device order.
4. The LIS claim API offers bounded `limit:1` with lease expiry timestamp; the ACK API rejects expired leases, saves a SHA-256 fingerprint of the precise ACK disposition and wire payload, and allows an identical same-attempt replay only when the work order is no longer claimed. It rejects different payloads/tokens and old leases after a new claim; no duplicate audit or analyzer raw message is generated for an exact replay.
5. Fail-closed defaults on unsupported/misconfigured adapters, directory nesting, wrong device key, symlinks/untrusted files, ambiguous/orphan receipts, expired leases, previous completed work-order attempts or multiple simultaneous workers. Operator reconciliation is required; there is no unsafe automated device replay.
6. Backward-compatible additive MariaDB migration `20261013160000_analyzer_work_order_ack_replay`, persistent last-ACK token hash/fingerprint (no cleartext in DB). No changes to released clinical/financial history.
7. Tests: Node spool/receipt/crash/concurrency tests, source/Safety tests and extended dual-session real MariaDB work-order ACK replay tests. Existing Prisma migration/status/generate, TypeScript, ESLint, i18n/RTL UI checks and Next production build continue in CI.

## Explicit commissioning restrictions

- **No device connection, physical sending, ASTM serial protocol or HL7 outbound vendor mapping is enabled by this merge.** Running the outbound process requires `ANALYZER_BRIDGE_OUTBOUND_ENABLED=true` AND `outbound.enabled=true`, `vendorApproved=true`, `mode=FILE_HANDOFF`, approved analyzer-specific device key, restricted local paths and a separate real-device adapter that writes truthful receipts.
- The local `CLAIM_DURABLY_STAGED_NOT_SENT` status is *not a result, analyzer order execution, medical validation, result release or clinical approval*.
- Full physical analyzer handshake, vendor-specific ASTM/HL7 order formatting, actual instrument acknowledgements, network/firewall controls, spool encryption/backup and laboratory UAT are **DEFERRED until final system acceptance**. Never claim these passed from CI.
- Retain all external communications disabled unless specifically configured/approved. No automatic patient notifications or data leakage.
- No clinical reference interval, QC, result validation or report mutation is introduced by this stage; previous rules and historical snapshots remain authoritative.

## Acceptance record

- [ ] Latest feature branch CI SUCCESS on exact final SHA
- [ ] PR reviewed, ready, merged with expected feature head SHA
- [ ] Independent main CI SUCCESS on exact merge SHA
- [ ] Owner confirms Hostinger deployment of new SHA (not inferred from CI)
- [ ] Real device/instrument/vendor/manual/security/clinical UAT **DEFERRED, NOT PASSED**
