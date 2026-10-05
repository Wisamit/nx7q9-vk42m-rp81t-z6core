CREATE TABLE `critical_escalation_policies` (
  `id` CHAR(36) NOT NULL,
  `organization_id` CHAR(36) NOT NULL,
  `test_id` CHAR(36) NOT NULL,
  `branch_id` CHAR(36) NULL,
  `acknowledgement_minutes` INT NOT NULL DEFAULT 30,
  `escalation_interval_minutes` INT NOT NULL DEFAULT 15,
  `max_escalation_level` INT NOT NULL DEFAULT 3,
  `require_read_back` BOOLEAN NOT NULL DEFAULT true,
  `effective_from` DATETIME(3) NOT NULL,
  `effective_to` DATETIME(3) NULL,
  `status` ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  `deactivated_at` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  INDEX `critical_escalation_policies_test_branch_status_dates_idx`(`test_id`,`branch_id`,`status`,`effective_from`,`effective_to`),
  INDEX `critical_escalation_policies_org_status_idx`(`organization_id`,`status`),
  CONSTRAINT `critical_escalation_policies_org_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `critical_escalation_policies_test_fkey` FOREIGN KEY (`test_id`) REFERENCES `lab_tests`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `critical_escalation_policies_branch_fkey` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `critical_result_events`
  ADD COLUMN `escalation_policy_id` CHAR(36) NULL AFTER `closed_at`,
  ADD COLUMN `acknowledgement_due_at` DATETIME(3) NULL AFTER `escalation_policy_id`,
  ADD COLUMN `escalation_level` INT NOT NULL DEFAULT 0 AFTER `acknowledgement_due_at`,
  ADD COLUMN `next_escalation_due_at` DATETIME(3) NULL AFTER `escalation_level`,
  ADD COLUMN `max_escalation_level_snapshot` INT NULL AFTER `next_escalation_due_at`,
  ADD COLUMN `escalation_interval_minutes_snapshot` INT NULL AFTER `max_escalation_level_snapshot`,
  ADD COLUMN `require_read_back_snapshot` BOOLEAN NOT NULL DEFAULT false AFTER `escalation_interval_minutes_snapshot`,
  ADD INDEX `critical_result_events_escalation_policy_idx`(`escalation_policy_id`),
  ADD INDEX `critical_result_events_status_ack_due_idx`(`status`,`acknowledgement_due_at`),
  ADD CONSTRAINT `critical_result_events_escalation_policy_fkey`
    FOREIGN KEY (`escalation_policy_id`) REFERENCES `critical_escalation_policies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
