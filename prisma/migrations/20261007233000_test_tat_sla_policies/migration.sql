-- Stage 3 / Part 2: effective-dated branch/priority TAT SLA policies.
-- Existing order-item TAT snapshots remain unchanged and keep their historical source.
ALTER TABLE `order_items`
  MODIFY COLUMN `tat_snapshot_source`
    ENUM('CATALOG_SNAPSHOT','SLA_POLICY','NOT_CONFIGURED','MIGRATED_BASELINE')
    NOT NULL DEFAULT 'NOT_CONFIGURED';

CREATE TABLE `test_tat_policies` (
  `id` CHAR(36) NOT NULL,
  `test_id` CHAR(36) NOT NULL,
  `branch_id` CHAR(36) NULL,
  `priority` ENUM('ROUTINE','URGENT','STAT') NULL,
  `tat_minutes` INTEGER NOT NULL,
  `alert_before_minutes` INTEGER NULL,
  `effective_from` DATETIME(3) NOT NULL,
  `effective_to` DATETIME(3) NULL,
  `status` ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  `created_by_user_id` CHAR(36) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `test_tat_policies_test_status_effective_idx` (`test_id`, `status`, `effective_from`, `effective_to`),
  INDEX `test_tat_policies_branch_status_effective_idx` (`branch_id`, `status`, `effective_from`, `effective_to`),
  INDEX `test_tat_policies_scope_status_effective_idx` (`test_id`, `branch_id`, `priority`, `status`, `effective_from`),
  INDEX `test_tat_policies_creator_created_idx` (`created_by_user_id`, `created_at`),
  CONSTRAINT `test_tat_policies_test_fkey`
    FOREIGN KEY (`test_id`) REFERENCES `lab_tests`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `test_tat_policies_branch_fkey`
    FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `test_tat_policies_creator_fkey`
    FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `order_items`
  ADD COLUMN `tat_alert_before_minutes_snapshot` INTEGER NULL AFTER `tat_due_at`,
  ADD COLUMN `tat_alert_at` DATETIME(3) NULL AFTER `tat_alert_before_minutes_snapshot`,
  ADD COLUMN `tat_policy_id` CHAR(36) NULL AFTER `tat_alert_at`,
  ADD INDEX `order_items_tat_alert_due_status_idx` (`tat_alert_at`, `tat_due_at`, `status`),
  ADD INDEX `order_items_tat_policy_id_idx` (`tat_policy_id`),
  ADD CONSTRAINT `order_items_tat_policy_fkey`
    FOREIGN KEY (`tat_policy_id`) REFERENCES `test_tat_policies`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;
