# Stage 101 — Recall Quality Follow-up

Baseline: main 9730ea9c (Stages 97–100, CI 1157). Hostinger last confirmed e3a0d3fc (Stage 96).

A read-only bilingual page lists quality nonconformance links for authorized branches with stable pagination, status filters and a lot-evidence link. Staff need inventory.view and quality.nonconformance.manage. Existing investigation and closure workflows remain in Quality Management.

Acceptance: no tenant or branch spillover, no patient/finance/clinical history updates, preserved closed cases, Node safety tests, MariaDB integration, TypeScript, ESLint, UI language validation, production build, independent main CI after merge.

No new database migration or secrets in this stage. When deploying, first back up production and include all pending migrations from Stages 97, 99 and 100. Existing draft PRs 128 and 209 remain unchanged.
