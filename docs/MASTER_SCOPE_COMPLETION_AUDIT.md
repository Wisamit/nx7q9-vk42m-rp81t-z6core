# Master Scope Completion Audit

This document tracks scope items that remain incomplete or require production acceptance after roadmap Phases 1–18.

The authoritative product target remains `02_MASTER_SCOPE.md`. Completing the implementation roadmap does not remove any item from the master scope.

## Status definitions

- **Implemented** — code/schema/workflow exists; still subject to final UAT.
- **Partial** — foundation exists but one or more explicitly scoped capabilities remain.
- **Gap** — no complete implementation was found in the current codebase.
- **Infrastructure** — application support exists but deployment/provider configuration must be completed and evidenced.

## Verified completion areas

The current codebase contains substantial implementations for:
- organization/branches and branch-scoped access;
- central patient identity;
- test catalog, components, panels, effective reference intervals and pricing;
- orders, invoices/payments, specimen/barcode workflow and inter-branch transfers;
- laboratory worklists, manual/analyzer results, validation, critical values, amendments and report versioning;
- microbiology;
- analyzer integration foundation and analyzer message traceability;
- inventory/procurement;
- equipment, maintenance, calibration, QC/Westgard;
- quality management/CAPA/document control/training/internal audit;
- patient/doctor/corporate portal foundations, appointments, home collection and queue;
- analytics and branch comparison;
- HL7/FHIR/LOINC/API/webhook interoperability;
- resilience, retention protection, DR evidence, health checks and non-clinical edge buffering.

## Known partial/gap items to close

### Orders and catalog
- **Partial** — commercial packages are not yet a first-class configurable catalog entity.
- **Gap** — test-specific ask-at-order questions/answers.
- **Partial** — specialized result-entry experiences beyond the generic result UI and microbiology.
- **Partial** — explicit rerun/repeat markers and bulk result entry need acceptance/completion.
- **Partial** — bidirectional analyzer order transmission is architecture-ready but not a complete operational workflow.

### Billing and financial operations
These require explicit accounting policy review before implementation because incorrect assumptions can alter financial history.
- **Gap** — refunds.
- **Gap** — credit notes.
- **Gap** — configurable discount limits/approval thresholds/approver workflow.
- **Partial** — corporate credit-account statements, aging and account limits.
- **Gap** — cashier shifts/closing/reconciliation.
- **Partial** — configurable tax-rule master data; currency is already explicit.
- **Partial** — financial reporting filters and refund/tax metrics require completion.

### Specimen and send-out
- **Partial** — aliquot parent/child architecture exists, but full operational aliquot creation/storage/usage workflow needs completion.
- **Partial** — test-specific rejection/recollection behavior needs acceptance/completion.
- **Gap** — external referral/send-out laboratory workflow, including external accession, cost, TAT and returned external result.

### Result/reporting
- **Partial** — distinct configurable Technical Review vs Medical Validation paths.
- **Gap** — cumulative/trend diagnostic report view.
- **Gap** — versioned report template designer with branch templates, logos, headers/footers, columns, signatures, language, QR and watermark.
- **Partial** — print/portal delivery exists; provider-backed email/SMS/WhatsApp delivery requires completion.
- **Gap** — generic secure attachment subsystem for patient/order/referral/result/external report/equipment/maintenance/quality/SOP.

### Search, notifications and rules
- **Gap** — organization-wide/branch-safe global search across patient, phone, MRN, accession, barcode, invoice and doctor/client.
- **Gap** — event-driven notification framework with in-app/email/SMS/WhatsApp channels and delivery logs/preferences.
- **Partial** — rules engine is strong for clinical/reflex/validation rules but does not yet cover all scoped routing/payment/notification trigger use cases.
- **Partial** — test-specific SLA/TAT alerting.

### Security
- **Implemented/partial** — strong password hashing, session controls, least privilege, branch scopes and audit exist.
- **Gap** — explicit MFA capability for staff accounts.
- **Gap** — distributed/request rate limiting beyond per-account failed-login lockout.
- **Partial** — deployment-level security headers/HTTPS enforcement and secret-management verification.
- **Gap/blocked by storage decision** — secure private file access for the attachment subsystem.

### Configuration and migration
- **Partial** — catalog/reference-range import exists, but controlled import/export must cover components, prices, units, mappings and selected configuration.
- **Partial** — legacy migration tooling does not yet cover all scoped configuration classes such as prices, comments, organisms, antibiotics, referrers/sources and optional historical selections.

### Production/infrastructure acceptance
- **Infrastructure** — automatic database/file backups, offsite copies and retention must be configured in the selected hosting/storage providers.
- **Infrastructure** — high availability requires actual redundant deployment/database/storage infrastructure.
- **Acceptance** — a real restore test with a real backup artifact must be completed and recorded.
- **Acceptance** — end-to-end UAT, security review and branch-isolation acceptance remain required before declaring Production Complete.

## Completion order

Recommended implementation order:
1. Global Search.
2. Notification framework.
3. Versioned Report Template Designer.
4. Orders/catalog gaps: questions, packages, bulk/repeat workflow.
5. Send-out labs and attachment subsystem (after secure storage provider decision).
6. Financial completion after explicit accounting-policy decisions.
7. Security hardening: MFA, rate limiting, headers.
8. Configuration import/export and legacy migration expansion.
9. End-to-end UAT and infrastructure acceptance.

No item in this file is a scope removal. Items remain part of the target until implemented or explicitly removed by the project owner.
