-- Optional legacy rows remain null. New payment postings carry a tenant-scoped
-- immutable request key, canonical fingerprint, and replay-safe response snapshot.
ALTER TABLE `payments`
  ADD COLUMN `posting_key` CHAR(36) NULL,
  ADD COLUMN `posting_fingerprint` CHAR(64) NULL,
  ADD COLUMN `posting_response_snapshot` JSON NULL;
CREATE UNIQUE INDEX `payments_organization_id_posting_key_key`
  ON `payments`(`organization_id`, `posting_key`);
