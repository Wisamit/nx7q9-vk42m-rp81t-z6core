ALTER TABLE `order_items`
  ADD COLUMN `tat_minutes_snapshot` INT NULL AFTER `status`,
  ADD COLUMN `tat_clock_basis_snapshot` ENUM('ORDERED_AT') NULL AFTER `tat_minutes_snapshot`,
  ADD COLUMN `tat_clock_started_at` DATETIME(3) NULL AFTER `tat_clock_basis_snapshot`,
  ADD COLUMN `tat_due_at` DATETIME(3) NULL AFTER `tat_clock_started_at`,
  ADD COLUMN `tat_snapshot_source` ENUM('CATALOG_SNAPSHOT','NOT_CONFIGURED','MIGRATED_BASELINE') NOT NULL DEFAULT 'MIGRATED_BASELINE' AFTER `tat_due_at`,
  ADD INDEX `order_items_tat_due_status_idx`(`tat_due_at`, `status`);

ALTER TABLE `order_items`
  MODIFY `tat_snapshot_source` ENUM('CATALOG_SNAPSHOT','NOT_CONFIGURED','MIGRATED_BASELINE') NOT NULL DEFAULT 'NOT_CONFIGURED';
