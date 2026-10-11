-- Stage 68: add a tenant/branch/action/type scoped AuditEvent keyset index.
-- The equality prefix supports both draft and independent-review event
-- watermarks (COUNT and most recent) and bounded (occurred_at, id) paging.
-- Read-only performance change: do not modify, truncate, or rewrite AuditEvent history.
-- On large production audit tables, provision a maintenance window and
-- a verified backup before deploying this index migration.
CREATE INDEX `audit_events_policy_queue_scan_idx`
  ON `audit_events` (
    `organization_id`, `branch_id`, `action`, `entity_type`,
    `occurred_at`, `id`
  );
