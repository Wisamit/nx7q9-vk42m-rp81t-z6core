# Stage 108 — Analyzer Bridge integration and clinical staging integrity

## Scope evidence (2026-10-13)

- Base: exact main `479b8bf006d0ed7f79f21ad0998ad30c2c03e430`, main CI #1206 SUCCESS.
- Master Scope §31: ASTM/HL7 v2 adapter, MLLP/TCP receiver, raw message and analyzer mapping flow.
- Master Scope §32: outgoing work orders/ACK workflows already on main (Stage 10); this stage does **not** recreate or auto-enable device-specific bidirectional communications.
- Draft #128 remains unmerged and untouched; its valuable bridge adapters and targeted safety fixes were reviewed and selectively restaged from that historic branch.
- Existing APIs already authenticate device-bound credentials, enforce tenant/branch mapping and stage observations. This stage fixes raw-payload fidelity and serializes competing normalized staging requests using the parent message and physical specimen custody row locks.
- No schema migration. No automatically released/approved clinical result, no new diagnostic interpretations or reference ranges, no provider/device configured.

## Changes

1. Isolated `bridge/` Node service with conservative HL7 ORU^R01 and ASTM E1394 record parsing, ASTM E1381 frame checksum/sequence validation (no unsupported serial handshake), durable local MLLP ACK spool, file retries/quarantine, and HTTPS authenticated LIS transport.
2. Raw message API retains exact CR/LF, spacing and bytes represented by valid UTF-8; rejects oversize and contradictory (analyzer,messageId,payload) retries; concurrent duplicate handling is DB-index based and audited.
3. Normalized result API re-reads per-message imports under row lock and locks specimen custody to prevent duplicate observation claims and stale transferred/rejected specimen staging.
4. Clinical import commit now locks custody and mapping claims before writing values; applies exact optimistic revision and editable-status guards; confirms every staged import was atomically consumed. Existing independently configured clinical validation/QC policy remains authoritative.
5. Worker rejects invalid UTF-8 outright rather than normalizing replacement characters into apparently authentic raw data.
6. Bridge protocol/spool tests + MariaDB multi-connection idempotency/clinical row-lock test + Safety, TypeScript, lint, i18n/theme and production build via CI.

## Security and policy boundary

- Bridge service defaults to loopback and requires explicit profile, device credential, restricted filesystem and retention configuration outside Git.
- Local MLLP positive ACK means **durably queued only**. `SENT_TO_LIS_STAGING` means the raw/staged data reached the LIS; it is **not medically verified**.
- Manual clinical approval, QC policy, specimen chain-of-custody verification, immutable released report amendments and audited critical communication remain LIS responsibilities.
- Physical analyzer manufacturer/firmware/vendor mapping, serial ENQ/ACK/NAK/EOT, device outbound query adapters, firewall, high availability, spool backup and clinical commissioning/UAT: **DEFERRED**, not passed or removed from Master Scope.
- Neither Hostinger nor device transport is auto-enabled by merging this stage.
