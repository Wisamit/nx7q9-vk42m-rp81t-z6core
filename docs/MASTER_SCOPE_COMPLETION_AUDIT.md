# Master Scope Completion Audit

This document tracks scope items that remain incomplete or require production acceptance after roadmap Phases 1–18 and the subsequent master-scope completion increments.

The authoritative product target remains `02_MASTER_SCOPE.md`. Completing the implementation roadmap does not remove any item from the master scope.

## Status definitions

- **Implemented** — code/schema/workflow exists; still subject to final UAT.
- **Partial** — foundation exists but one or more explicitly scoped capabilities remain.
- **Gap** — no complete implementation was found in the current codebase.
- **Infrastructure** — application support exists but deployment/provider configuration must be completed and evidenced.
- **Acceptance** — implementation exists but requires real-world validation before Production Complete.

## Verified completion areas

The current codebase contains substantial implementations for:
- organization/branches and branch-scoped access;
- central patient identity and duplicate-aware patient workflows;
- test catalog, components, panels, commercial packages, ask-at-order questions, effective reference intervals and pricing;
- orders, invoices/payments, specimen/barcode workflow and inter-branch transfers;
- laboratory worklists, bulk result entry, rerun/repeat traceability, manual/analyzer results, validation, critical values, amendments and report versioning;
- microbiology;
- analyzer integration foundation and analyzer message traceability;
- inventory/procurement;
- equipment, maintenance, calibration, QC/Westgard;
- quality management/CAPA/document control/training/internal audit;
- patient/doctor/corporate portal foundations, appointments, home collection and queue;
- analytics, branch comparison and currency-separated profitability including linked inventory and send-out cost;
- HL7/FHIR/LOINC/API/webhook interoperability;
- resilience, protected retention, DR evidence, health checks, MariaDB migration validation and non-clinical edge buffering;
- branch-safe global search;
- event-driven in-app/outbound notification framework with retry/dead-letter and preferences;
- versioned branch-aware report template designer with immutable released snapshots;
- external referral/send-out laboratory workflow with external accession, cost/TAT, returned result and custody evidence;
- secure audited private attachment subsystem;
- staff TOTP MFA capability, recovery codes, distributed database-backed login throttling and application security headers.

## Remaining partial/gap items to close

### Orders, laboratory workflow and catalog
- **Partial** — specialized result-entry experiences beyond the generic result UI and microbiology remain configuration/workflow dependent.
- **Partial** — bidirectional analyzer order transmission is architecture-ready, but a complete operational analyzer work-order transmission workflow remains.
- **Partial** — full operational aliquot creation/storage/usage workflow needs completion.
- **Partial/Acceptance** — test-specific rejection/recollection behavior requires final workflow acceptance.

### Billing and financial operations

These require explicit accounting policy review before implementation because incorrect assumptions can alter financial history.

- **Gap** — refunds.
- **Gap** — credit notes.
- **Gap** — configurable discount limits/approval thresholds/approver workflow.
- **Partial** — corporate credit-account statements, aging and account limits.
- **Gap** — cashier shifts/closing/reconciliation.
- **Partial** — configurable tax-rule master data; currency is already explicit.
- **Partial** — financial reporting filters and refund/tax metrics require completion.

### Result validation and reporting
- **Partial** — distinct configurable Technical Review vs Medical Validation paths.
- **Gap** — cumulative/trend diagnostic report view.
- **Infrastructure** — outbound EMAIL/SMS/WHATSAPP delivery framework exists, but actual provider credentials/gateways must be configured and acceptance-tested.
- **Partial** — test-specific SLA/TAT alerting and escalation policy coverage.

### Rules and workflow automation
- **Partial** — the rules engine is strong for clinical/reflex/validation rules but does not yet cover every scoped routing/payment/notification trigger use case.

### Security and deployment
- **Implemented/Infrastructure** — staff MFA is implemented; production must configure a strong `APP_ENCRYPTION_KEY` before MFA enrollment is allowed.
- **Implemented** — database-backed rate limiting protects staff and portal login across application instances.
- **Implemented/Infrastructure** — application security headers and production HSTS are configured; TLS termination and secret-management policy must be verified in the hosting environment.
- **Partial** — high-risk electronic approvals can record approver/audit context, but per-action re-authentication/MFA enforcement is not yet universal across all approval workflows.
- **Acceptance** — security review, authorization/branch-isolation tests and recovery-code operational procedure remain required.

### Configuration and migration
- **Partial** — catalog/reference-range import exists, but controlled import/export must cover components, prices, units, terminology mappings and selected configuration.
- **Partial** — legacy migration tooling does not yet cover all scoped configuration classes such as prices, comments, organisms, antibiotics, referrers/sources and optional historical selections.

### Production/infrastructure acceptance
- **Infrastructure** — automatic database/file backups, offsite copies and retention must be configured in the selected hosting/storage providers.
- **Infrastructure** — high availability requires actual redundant deployment/database/storage infrastructure.
- **Acceptance** — a real restore test with a real backup artifact must be completed and recorded.
- **Acceptance** — end-to-end UAT, security review and branch-isolation acceptance remain required before declaring Production Complete.
- **Acceptance** — provider-backed notification delivery and analyzer/hospital integrations require environment-specific acceptance where used.

## Recommended completion order

1. Security hardening and deployment configuration.
2. Financial completion after explicit accounting-policy decisions.
3. Aliquot workflow and configurable Technical Review / Medical Validation.
4. Cumulative/trend reports and TAT/SLA completion.
5. Configuration import/export and legacy migration expansion.
6. Analyzer outbound order workflow where required by connected instruments.
7. End-to-end UAT, security/branch isolation, backup/restore and infrastructure acceptance.

No item in this file is a scope removal. Items remain part of the target until implemented or explicitly removed by the project owner.
