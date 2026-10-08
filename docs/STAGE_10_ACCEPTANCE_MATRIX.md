# Stage 10 — Analyzer integration engineering acceptance

**Base:** `main` at `c352796956b026afbe8e92196ea194b2779380ee` (Stage 9).  
**Working PR:** #129 (`stage-10-analyzer-integration-completion`).  
**Source scope:** `07_IMPLEMENTATION_ROADMAP.md` Phase 10, `02_MASTER_SCOPE.md` analyzer integration and multi-branch rules.

## Existing capability versus new capability

The existing system already supports analyzer master records, branch and department scopes, Analyzer Bridge bearer credentials, time-effective and governed test mappings, raw inbound message hash/logging, staged result imports, commit into versioned `LaboratoryResult`, QC/validation holds, analyzer routing assignment/clearing, and historical audit.

This increment adds **protocol-neutral, outbound order handoff to an authenticated Analyzer Bridge**. It deliberately does *not* create an insecure on-server TCP/serial driver, and it does not imply an instrument-specific device has been commissioned.

| Area | Engineering behavior | Acceptance evidence |
| --- | --- | --- |
| Worklist route | Recheck order item state, active specimen/test link, specimen location, branch scope, approved mapping and clinical lock inside DB transaction | `tests/stage-10-analyzer-routing-safety.test.ts` |
| Outbound handoff | When analyzer has a configured `bridgeDeviceKey` and the approved test has exactly one analyzer test code, route assignment creates a durable `AnalyzerWorkOrder` in the same transaction | Source assertions and migrations |
| Payload | Immutable accession, barcode, LIS and analyzer test codes, branch and analyzer references. No patient name. The Analyzer Bridge transforms into instrument-specific ASTM or HL7 messages | Snapshot and schema tests |
| Device identity | Dedicated Analyzer Bridge credential bound to analyzer; not staff session, browser, or unauthenticated webhooks | `authenticateAnalyzerBridge` |
| Claiming | `POST /api/integrations/analyzers/[id]/work-orders/claim` returns eligible queued/expired work orders with a short cryptographic lease. Before claiming it locks specimen and rechecks current branch, active route/link, analyzer/mapping, and pending clinical state | `tests/stage-10-analyzer-outbound-safety.test.ts`; MariaDB dual session |
| ACK/NACK | `POST /api/integrations/analyzers/[id]/work-orders/[workOrderId]/ack` accepts one of `ACCEPTED`, `RETRY`, `REJECTED` and requires the exact lease token. Only current lease can change state | Audit and MariaDB tests |
| Retries | Bounded progressive retry, default maximum 5 attempts, terminal `DEAD_LETTER`; expired claims may be reassigned but old ACKs are invalid | `tests/analyzer-work-orders-mariadb.integration.test.ts` |
| Route cancellation | Clearing a route atomically invalidates unsent and in-flight unacknowledged commands, keeping historical ACKs. Instrument commands already sent cannot be recalled; bridge must check state immediately before sending | Source and manual acceptance |
| Inbound results | Existing raw message and staged result imports continue. Concurrent identical message IDs return one idempotent record, different body under same ID returns 409 | API source and existing integration tests |

## Protocol contract and limitations

- The LIS provides an immutable *work-order envelope*, not fabricated ASTM or HL7 bytes. The separate Analyzer Bridge must know each device's actual analyzer test codes, protocol flavor, acknowledgement semantics, barcode/sequence rules, and physical link/transport. No default protocol inference is permitted.
- The Bridge must deduplicate by `workOrderId`; delivery is **AT_LEAST_ONCE** after a lease timeout. A successful `ACCEPTED` ACK signifies Bridge acceptance, **not** confirmed instrument processing or a released clinical result. The Bridge must separately preserve device response evidence in integration/audit channels.
- Sending work orders is **opt-in** by a configured `bridgeDeviceKey`. Ambiguous or missing effective analyzer test codes cause no outbound queue item; route audit explains why.
- Existing analyzer import, validation, QC gate and report release remain independently controlled.
- Multi-branch isolation is mandatory at each API and SQL boundary. Never dispatch an order to an analyzer located in a different branch than the currently available specimen.
- All clinical specimen statuses, historical result snapshots, billing, and released reports stay unchanged by outbound work-order delivery.

## Release gate

- [ ] Exact head CI: Prisma schema/migration deployment, test:safety, two-session MariaDB work-order lease and older integrations, TypeScript, lint and Next.js production build
- [ ] PR ready for review, merge to main, main CI SUCCESS
- [ ] Hosting deployment independently confirmed
- [ ] **Deferred to whole-project acceptance:** manual UI, real instrument/protocol traces, physical transport, order acceptance on each instrument, failover/replay/device dedupe, security and clinician/instrument validation.

**Production caveat:** Even after code passes CI, an instrument integration is NOT in clinical production until the actual bridge and device have been commissioned and signed off. Unconfigured instruments cannot receive orders.
