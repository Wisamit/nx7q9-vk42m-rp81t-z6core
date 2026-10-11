-- Stage 80: transient worker lease for at-least-once outbound notifications.
-- Existing delivery rows remain untouched; NULL means no active claimant.
ALTER TABLE `notification_deliveries`
  ADD COLUMN `dispatch_token` CHAR(36) NULL AFTER `next_attempt_at`,
  ADD COLUMN `dispatch_lease_until` DATETIME(3) NULL AFTER `dispatch_token`,
  ADD INDEX `notification_deliveries_dispatch_lease_idx`
    (`status`,`dispatch_lease_until`,`next_attempt_at`);
