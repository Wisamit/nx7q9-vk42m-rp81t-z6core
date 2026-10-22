-- One portal account and idempotency UUID can create at most one booking.
-- NULL keys preserve older portal/staff appointment paths and historical rows.
-- The payload fingerprint is retained for conflict detection, never logged.
ALTER TABLE `appointments`
  ADD COLUMN `portal_submission_key` CHAR(36) NULL,
  ADD COLUMN `portal_submission_hash` CHAR(64) NULL,
  ADD UNIQUE INDEX `appointment_portal_submission_uq`
    (`portal_account_id`, `portal_submission_key`);
