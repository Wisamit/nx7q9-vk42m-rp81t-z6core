CREATE TABLE `autoverification_policies` (
  `id` CHAR(36) NOT NULL,
  `organization_id` CHAR(36) NOT NULL,
  `test_id` CHAR(36) NOT NULL,
  `branch_id` CHAR(36) NULL,
  `enabled` BOOLEAN NOT NULL DEFAULT false,
  `allow_manual` BOOLEAN NOT NULL DEFAULT false,
  `allow_analyzer` BOOLEAN NOT NULL DEFAULT true,
  `allow_import` BOOLEAN NOT NULL DEFAULT false,
  `require_no_critical` BOOLEAN NOT NULL DEFAULT true,
  `require_delta_within_limit` BOOLEAN NOT NULL DEFAULT true,
  `require_no_pending_reflex` BOOLEAN NOT NULL DEFAULT true,
  `require_no_blocking_holds` BOOLEAN NOT NULL DEFAULT true,
  `require_all_flags_normal` BOOLEAN NOT NULL DEFAULT false,
  `effective_from` DATETIME(3) NOT NULL,
  `effective_to` DATETIME(3) NULL,
  `status` ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  `deactivated_at` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  INDEX `autoverification_policies_test_branch_status_dates_idx`(`test_id`,`branch_id`,`status`,`effective_from`,`effective_to`),
  INDEX `autoverification_policies_org_status_idx`(`organization_id`,`status`),
  CONSTRAINT `autoverification_policies_org_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `autoverification_policies_test_fkey` FOREIGN KEY (`test_id`) REFERENCES `lab_tests`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `autoverification_policies_branch_fkey` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `validation_hold_rules` (
  `id` CHAR(36) NOT NULL,
  `organization_id` CHAR(36) NOT NULL,
  `test_id` CHAR(36) NOT NULL,
  `branch_id` CHAR(36) NULL,
  `condition` ENUM('ALWAYS','RESULT_SOURCE','ANY_ABNORMAL','ANY_CRITICAL','DELTA_EXCEEDED') NOT NULL,
  `result_source` ENUM('MANUAL','ANALYZER','IMPORT','CALCULATED') NULL,
  `severity` ENUM('WARNING','BLOCK') NOT NULL DEFAULT 'BLOCK',
  `reason_en` VARCHAR(500) NOT NULL,
  `reason_ar` VARCHAR(500) NULL,
  `effective_from` DATETIME(3) NOT NULL,
  `effective_to` DATETIME(3) NULL,
  `status` ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  `deactivated_at` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  INDEX `validation_hold_rules_test_branch_status_dates_idx`(`test_id`,`branch_id`,`status`,`effective_from`,`effective_to`),
  INDEX `validation_hold_rules_org_status_idx`(`organization_id`,`status`),
  CONSTRAINT `validation_hold_rules_org_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `validation_hold_rules_test_fkey` FOREIGN KEY (`test_id`) REFERENCES `lab_tests`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `validation_hold_rules_branch_fkey` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `laboratory_results`
  ADD COLUMN `auto_verified` BOOLEAN NOT NULL DEFAULT false AFTER `comments`,
  ADD COLUMN `autoverification_policy_id` CHAR(36) NULL AFTER `auto_verified`,
  ADD COLUMN `autoverification_decision_snapshot` JSON NULL AFTER `autoverification_policy_id`,
  ADD INDEX `laboratory_results_autoverification_policy_idx`(`autoverification_policy_id`),
  ADD CONSTRAINT `laboratory_results_autoverification_policy_fkey`
    FOREIGN KEY (`autoverification_policy_id`) REFERENCES `autoverification_policies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE `validation_hold_events` (
  `id` CHAR(36) NOT NULL,
  `result_id` CHAR(36) NOT NULL,
  `rule_id` CHAR(36) NOT NULL,
  `status` ENUM('ACTIVE','RESOLVED','SUPERSEDED') NOT NULL DEFAULT 'ACTIVE',
  `severity_snapshot` ENUM('WARNING','BLOCK') NOT NULL,
  `reason_en_snapshot` VARCHAR(500) NOT NULL,
  `reason_ar_snapshot` VARCHAR(500) NULL,
  `reviewed_by_user_id` CHAR(36) NULL,
  `reviewed_at` DATETIME(3) NULL,
  `review_note` VARCHAR(1000) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `validation_hold_events_result_rule_key`(`result_id`,`rule_id`),
  INDEX `validation_hold_events_status_severity_created_idx`(`status`,`severity_snapshot`,`created_at`),
  INDEX `validation_hold_events_reviewed_idx`(`reviewed_by_user_id`,`reviewed_at`),
  CONSTRAINT `validation_hold_events_result_fkey` FOREIGN KEY (`result_id`) REFERENCES `laboratory_results`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `validation_hold_events_rule_fkey` FOREIGN KEY (`rule_id`) REFERENCES `validation_hold_rules`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `validation_hold_events_reviewed_by_fkey` FOREIGN KEY (`reviewed_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT IGNORE INTO `permissions` (`id`,`code`,`module`,`description`,`created_at`) VALUES
(UUID(),'validation_holds.review','results','Review and resolve validation hold events',CURRENT_TIMESTAMP(3));

INSERT IGNORE INTO `role_permissions` (`role_id`,`permission_id`,`granted_at`)
SELECT r.id, p.id, CURRENT_TIMESTAMP(3)
FROM `roles` r
JOIN `permissions` p ON p.code='validation_holds.review'
WHERE r.code='SYSTEM_ADMIN';
