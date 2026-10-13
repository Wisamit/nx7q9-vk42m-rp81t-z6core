# Stage 106 — Scheduled Communications Dispatch (Hostinger-ready, opt-in)

## Context and scope
- Baseline main `384de51065d86f0f5c9fa61f7214b7212bc3f1e1` (Stage 105 owner-confirmed Hostinger deployed; main CI #1195 SUCCESS).
- Authoritative product scope: Notifications, Reporting, Integrations, TAT, Operations, Audit and multi-branch organization isolation.
- Existing dispatchers already have independent notification leases, stable provider idempotency keys, retries/dead-letter, and webhook compare-and-set. Their only automated trigger was missing: the previous routes require an interactive authenticated staff invocation.
- No migration and no test names, recipients, prices or intervals are hard-coded.

## Delivered
1. `POST /api/cron/dispatch` for **one operation and one explicitly allowlisted tenant per invocation**. Valid `operation` values: `TAT`, `NOTIFICATIONS`, `WEBHOOKS`. No browser cookies, staff session, GET token or query-string credentials are supported.
2. Default disabled; explicit per-operation opt-in. Dedicated strong bearer credential verified using constant-time SHA-256 digest comparison and exact-header parsing. Tenant allowlist is mandatory; inactive organizations are rejected.
3. Bounded batches (TAT 40, outgoing notifications 8, webhooks 3), no automatic unbounded all-tenant scan and no assumption that a session branch belongs to a machine actor. Active endpoint/branch/subscription and organization isolation are checked before webhook dispatch. Existing claim/lease CAS controls concurrent workers.
4. `scripts/operations/run-scheduled-dispatch.mjs`: optional HTTPS-only Node runner with environment-only secrets and nonzero exit for failures, suited to hosting schedulers; no sensitive details printed.
5. Before sending queued `diagnostic_report.released` or `diagnostic_report.amended` webhooks, re-read their linked report version after claiming the delivery, fail closed if it is retracted, missing or superseded, and mark the obsolete event as terminal rather than retrying it. This applies to staff-triggered and scheduled dispatchers alike.
6. System-actor `AuditEvent` for each invocation: tenant, operation, enabled flags, counts, completion/failure only. No patient messages, raw destinations or provider secrets in the audit summary.
7. Outbound notification gateway hardened using the pre-existing `safeOutboundUrl`: public HTTPS, no credentialed URLs, no literal/private IP endpoints, redirects denied and a 12-second fetch timeout. DNS-based rebinding protection still requires host/network egress enforcement.

## Hostinger environment configuration (disabled by default)

Set these application environment variables **only after validating provider configuration and communication policy**:

| Variable | Meaning |
| --- | --- |
| `FAMILY_LAB_CRON_ENABLED` | `true` explicitly enables scheduled endpoint |
| `FAMILY_LAB_CRON_SECRET` | dedicated random 32–256-character token, generated locally with `openssl rand -hex 32`, never committed |
| `FAMILY_LAB_CRON_ORGANIZATION_IDS` | comma-separated explicitly approved organization UUIDs (max 32); no wildcards |
| `FAMILY_LAB_CRON_TAT_ENABLED` | `true` if in-app TAT escalation automation approved |
| `FAMILY_LAB_CRON_NOTIFICATIONS_ENABLED` | `true` only **after** Email/SMS/WhatsApp gateway settings, recipient verification and provider idempotency tested |
| `FAMILY_LAB_CRON_WEBHOOKS_ENABLED` | `true` only **after** destinations, egress policy and webhook receiver deduplication approved |

The enabled operations are independently guarded. If no operation is enabled, if the tenant ID is absent, or if secret/configuration is missing or invalid, the scheduled endpoint rejects the request. Deploying the code by itself never starts automatic external delivery.

To invoke a single approved operation through the optional Node runner, set these **scheduler-process** variables (the worker's dedicated environment):

```bash
FAMILY_LAB_CRON_URL=https://YOUR-LIS-HOST/api/cron/dispatch
FAMILY_LAB_CRON_TARGET_ORGANIZATION_ID=<approved-organization-uuid>
FAMILY_LAB_CRON_OPERATION=TAT
# FAMILY_LAB_CRON_SECRET is the same protected token configured in the application.
node scripts/operations/run-scheduled-dispatch.mjs
```

Use your actual Hostinger Node binary and repository path; do not assume the example directory or command is valid on every hosting plan. Configure separate scheduled invocations for `TAT`, `NOTIFICATIONS` and `WEBHOOKS`, for every allowlisted organization you intend to serve. Do not put bearer tokens in URL parameters, CLI arguments, committed code or job output.

Typical initial intervals, **only after acceptance**: TAT every 2 minutes, Notifications every 1–2 minutes, Webhooks every 2 minutes. Your Hostinger scheduler and server timeouts may require adjustment and the operations team must verify the actual supported cadence. Scheduler alerts must act on nonzero exit status or HTTP 503. Queued jobs retain existing retry budgets and dead-letter records; endpoint operation failures return HTTP 503 and create a system audit record.

## Provider and clinical safety
- External notification provider contract: accepts POST JSON from the app and **must deduplicate** on the stable `Idempotency-Key`; statuses are provider acknowledgements, not proof of recipient reading.
- Existing report release/version checks remain mandatory. No scheduled release, amendment, billing or test-result edits are performed by this worker.
- Ensure messages contain no unnecessary PHI and links require portal authentication; verify recipients/consent and legal/compliance rules with qualified operators before enabling outbound channels.
- Webhook receivers must honor `x-family-lab-delivery-id` to prevent duplicates after a lease/retry.
- TLS is necessary but not sufficient; add network-layer egress allowlists / DNS rebinding controls, monitor gateway certificates, test offsite restore and document credentials rotation.
- Existing manual permission-guarded dispatch APIs remain for authorized operators.

## CI and acceptance
- `tests/stage-106-scheduled-dispatch-safety.test.ts`: missing secret, unauthorized tenant, malformed credential, disabled channel, route and transport contracts.
- `tests/stage-106-scheduled-dispatch-mariadb.integration.test.ts`: real MariaDB active/inactive branches, cross-tenant webhook/notification queues, system actor audit and lock conflict.
- Execute full feature CI at exact final SHA, merge PR only after green; independently check green `main` CI at merge SHA.
- Hostinger deploy is **not** complete until explicitly confirmed by the owner. Environment opt-in, approved providers and end-to-end delivery/UAT remain pending the final operational acceptance phase.
- Draft PRs #128, #209 and #224 untouched.
