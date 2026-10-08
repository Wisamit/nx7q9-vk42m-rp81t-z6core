# Stage 10 — Analyzer Integration Acceptance Matrix

**Baseline:** `main` at `c352796956b026afbe8e92196ea194b2779380ee` (Stage 9 confirmed deployed by owner).  
**Working branch:** `stage-10-analyzer-bridge-integration`.  
**Roadmap:** `07_IMPLEMENTATION_ROADMAP.md` Phase 10: Analyzer Bridge, ASTM, HL7 v2, serial/TCP/file, mapping, raw message logging, import, bidirectional orders and retries.

## Implementation scope and boundaries

| Area | Existing LIS capability | Stage 10 addition or acceptance boundary |
| --- | --- | --- |
| Analyzer registry and credentials | Per-organization, per-branch `Analyzer`, hashed bridge credential, expiry and deactivation | Never embed shared tokens in frontend or Git; Bridge uses a unique bearer secret |
| Test mapping governance | Active/effective-dated mapping and approved reviewer, unit snapshot validation and performed-analyzer route | No incoming analyzer code auto-maps to a different test; no unapproved unit conversion |
| Raw message and audit | Unique `analyzerId + bridgeMessageId`, raw payload, payload SHA256, receipt actor/credential and processing status | Preserve exact string bytes incl. CR/LF/whitespace; 1 MB decoded size cap, no truncation; unique conflict handles concurrent retries |
| Transport bridge | Previously only authenticated REST receiver endpoints | Separate Node service: HL7 MLLP TCP listener, spool before local ACK, durable file poller with retries and quarantine; no raw frame inside Next.js runtime |
| HL7 v2 normalized messages | Prior REST endpoint accepts bridge-provided normalized observations | Conservative ORU^R01 with explicit OBR-3 or SPM-2 barcode profile, limited NM/ST/TX OBX and rejected ambiguous values |
| ASTM normalization | Prior raw protocol enum and interface message logs | **Record-only E1394 subset** with manually approved field profile, no unchecked low-level ASTM E1381 serial frames |
| TCP/file/serial | Analyzer registry supports SERIAL, TCP, WATCH_FOLDER types | Implemented MLLP/TCP listener + staged files. E1381 serial handshake, proprietary TCP adapters and device-specific watch-folder writers require device engineering, not implied |
| Staging | Active approved mapping, barcode/organization matching, specimen custody and error/replay queue | Exact branch and status must be rechecked inside transaction during clinical commit |
| Clinical result import | Staged result import with reference/critical/delta/QC/autoverification, audit and versioned result | Locked specimen, locked incoming rows and optimistic status/revision CAS before touching values; conflicting imports must roll back |
| Bidirectional orders | Registry/routing architecture only | **Not enabled** without concrete analyzer query/order vocabulary and vendor sample; never fabricate outbound instrument worklist |
| Error recovery | Manual replay, received/processed/error/dead-letter statuses | File spool survives network outages and bridge restarts; unchanged message ID and observation IDs prevent duplicate import |
| Historical clinical safety | Versioned LaboratoryResult/report, raw import references | No overwrite of verified, released, amended history. No automatic verification without approved clinical/QC policy |

## Engineering gates

- [ ] Exact-HEAD GitHub CI all green (MariaDB migrations + status, Prisma client, safety source tests, bridge protocol/MLLP/spool tests, MariaDB concurrency, TypeScript, ESLint, bilingual UI and Next production build).
- [ ] Validate stable raw-message UUID and protocol mismatch/conflict handling under concurrent retries.
- [ ] Confirm analyzer import transaction locks custody and claims same editable result revision before any clinical value mutation.
- [ ] Review exception semantics for device parser failures and non-UTF8/raw binary ASTM.
- [ ] Confirm externally supplied message IDs are bounded and duplicate observations are idempotent.
- [ ] No automatic serial transport activation or outbound/bidirectional orders without manufacturer config, device credential and network policy.
- [ ] Full real-analyzer/bridge hardware UAT **DEFERRED** per user until whole-project testing. It is **not** equivalent to a passing CI or accepted clinical deployment.

## Pending real-lab acceptance, retained in scope

- Actual analyzer manufacturer/model/firmware/interface manuals and per-device test vectors.
- Serial ENQ/ACK/NAK/EOT, multi-frame checksum/retry limits, interface device port/baud/parity when required.
- Vendor-specific MLLP ACK semantics, unusual OBX types and units, abnormal/critical flags, QC handling, manufacturer-specific error frames.
- Bi-directional orders and instrument worklist query handling only where hardware supports them.
- Physical cable/VLAN/firewall, offline recovery, audit/retention and supervisor behavior for production branches.
- Lab-validated reference interpretation and end-to-end comparison between instrument printout and immutable LIS report.

No protocol adapter can be labeled universally ASTM/HL7-compliant based on these generic tests. Unknown vendor formats fail closed.
