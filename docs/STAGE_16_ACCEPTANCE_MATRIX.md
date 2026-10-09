# Stage 16 — Interoperability & Integration Integrity Acceptance

**Starting main:** `87b96437c3a0a6c94b8d868f413c93d337b9983c`, CI #861 success, owner confirmed Hostinger.  
**Scope:** `02_MASTER_SCOPE.md` section 76 (hospital/clinic/EHR, analyzer, portal, mobile, external integrations, HL7 v2/FHIR/LOINC/terminology), `07_IMPLEMENTATION_ROADMAP.md` Phase 17. No scope reductions.

## Existing integrations reused

Endpoint and API-key configuration with tenant and branch scopes; HL7 v2 inbound MSH/ACK message buffering and outbound ORU report outbox; external bridge message claim/ack; FHIR R4 Patient/ServiceRequest/Observation/DiagnosticReport; LOINC effective-dated mapping; outbound report webhooks, retries and delivery event trail.

## Hardened in Stage 16

| Area | Safety guarantee |
|---|---|
| HL7 inbound | Endpoint-row `FOR UPDATE` lock around control-ID deduplication and audit, serializable. Exact same MSH-10 + SHA-256 payload is acknowledged idempotently; same MSH-10 with **different content** is rejected (AR/409); no automatic clinical mutation. |
| Outbound HL7 | Claims stop at endpoint max attempt count; stale/incomplete deliveries reach DEAD_LETTER. ACK now requires exact attempt number supplied by claim, status SENT, and CAS revision; retries and ACKs are audited. |
| Webhook delivery | CAS claim QUEUED/FAILED/stale SENT → SENT before network I/O; lease recovery after 5 min, CAS completion by claimed revision and attempt, no concurrent double-send. Stable delivery ID and payload hash headers permit receiver dedupe. 4xx (except 408/429) dead-letter; backoff for transient errors and max-attempt cap. |
| Webhook egress | HTTPS required; literal IPs, local/special-use hostnames, embedded credentials and redirects refused; explicit network egress/DNS controls are **still required** to address DNS rebinding. |
| FHIR reads | Key/endpoint compatibility checked for FHIR/R4 or REST outbound channels; Observations require RELEASED/AMENDED and a *current non-retracted report containing that result*. Retracted DiagnosticReports disclose metadata entered-in-error but **no clinical observations**. |
| API keys | Key tenant must equal endpoint tenant; creation rejects scopes incompatible with endpoint type/direction. |
| Tests | Source safety regressions for every boundary; two-connection MariaDB lock/CAS tests for endpoint HL7 dedupe, webhook delivery and outbound ACK. CI runs all old and new integration suites. |

## Boundaries / future work

- [ ] Exact final feature-branch CI SUCCESS: migration deploy/status, safety suite, all MariaDB tests, tsc, ESLint, bilingual UI and Next.js build.
- [ ] Merge expected SHA into `main` and verify exact merged `main` CI SUCCESS.
- [ ] Hostinger deployed SHA to be confirmed independently by owner.
- [ ] External HL7 hospital protocols, actual analyzer connectivity, transport, vendor certificates, network allowlists, DNS/egress protection and provider-backed webhook delivery require **real interface acceptance** after whole LIS implementation is complete.
- [ ] HL7 ACK transport consumers must include `attempt` returned by `/api/integrations/messages/claim` when calling `/api/integrations/messages/[id]/ack` (intentional fail-closed contract hardening).
- [ ] Webhooks remain *at least once*, not exactly once; receiver must dedupe using `x-family-lab-delivery-id`. Lease expiry may cause a later retry after worker death.
- [ ] Large legacy HL7 messages and richer ORM inbound clinical order mapping remain outside this safety increment, not removed from scope.
- [ ] Analyzer Bridge PR #128 stays **OPEN DRAFT and UNMERGED** until separately rebased, reviewed, tested and specifically accepted. No merging stale branch into current main.
- [ ] Manual/device/clinical/e2e UAT deferred by owner's explicit instruction until full LIS is complete.

**Do not mistake CI for a clinical-interface certification or a verified Hostinger deployment.**
