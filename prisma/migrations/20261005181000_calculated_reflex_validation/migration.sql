ALTER TABLE `laboratory_result_values`
  ADD COLUMN `is_calculated` BOOLEAN NOT NULL DEFAULT false AFTER `delta_percent_limit_snapshot`,
  ADD COLUMN `calculated_rule_id` CHAR(36) NULL AFTER `is_calculated`,
  ADD COLUMN `calculation_expression_snapshot` VARCHAR(1000) NULL AFTER `calculated_rule_id`,
  ADD COLUMN `calculation_inputs_snapshot` JSON NULL AFTER `calculation_expression_snapshot`,
  ADD INDEX `laboratory_result_values_calculated_rule_idx`(`calculated_rule_id`);

CREATE TABLE `calculated_result_rules` (
  `id` CHAR(36) NOT NULL,
  `organization_id` CHAR(36) NOT NULL,
  `test_id` CHAR(36) NOT NULL,
  `target_component_id` CHAR(36) NOT NULL,
  `expression` VARCHAR(1000) NOT NULL,
  `decimal_precision` INT NULL,
  `effective_from` DATETIME(3) NOT NULL,
  `effective_to` DATETIME(3) NULL,
  `status` ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  `deactivated_at` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  INDEX `calculated_result_rules_test_status_dates_idx`(`test_id`,`status`,`effective_from`,`effective_to`),
  INDEX `calculated_result_rules_target_status_idx`(`target_component_id`,`status`),
  CONSTRAINT `calculated_result_rules_org_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `calculated_result_rules_test_fkey` FOREIGN KEY (`test_id`) REFERENCES `lab_tests`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `calculated_result_rules_target_component_fkey` FOREIGN KEY (`target_component_id`) REFERENCES `test_components`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `laboratory_result_values`
  ADD CONSTRAINT `laboratory_result_values_calculated_rule_fkey` FOREIGN KEY (`calculated_rule_id`) REFERENCES `calculated_result_rules`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE `reflex_rules` (
  `id` CHAR(36) NOT NULL,
  `organization_id` CHAR(36) NOT NULL,
  `source_test_id` CHAR(36) NOT NULL,
  `source_component_id` CHAR(36) NULL,
  `branch_id` CHAR(36) NULL,
  `operator` ENUM('LT','LTE','GT','GTE','EQ','NE','CONTAINS') NOT NULL,
  `numeric_threshold` DECIMAL(24,8) NULL,
  `text_threshold` VARCHAR(500) NULL,
  `target_test_id` CHAR(36) NOT NULL,
  `note_en` VARCHAR(500) NULL,
  `note_ar` VARCHAR(500) NULL,
  `effective_from` DATETIME(3) NOT NULL,
  `effective_to` DATETIME(3) NULL,
  `status` ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  `deactivated_at` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  INDEX `reflex_rules_source_component_status_dates_idx`(`source_test_id`,`source_component_id`,`status`,`effective_from`,`effective_to`),
  INDEX `reflex_rules_branch_status_idx`(`branch_id`,`status`),
  INDEX `reflex_rules_target_status_idx`(`target_test_id`,`status`),
  CONSTRAINT `reflex_rules_org_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `reflex_rules_source_test_fkey` FOREIGN KEY (`source_test_id`) REFERENCES `lab_tests`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `reflex_rules_source_component_fkey` FOREIGN KEY (`source_component_id`) REFERENCES `test_components`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `reflex_rules_branch_fkey` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `reflex_rules_target_test_fkey` FOREIGN KEY (`target_test_id`) REFERENCES `lab_tests`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `reflex_rule_events` (
  `id` CHAR(36) NOT NULL,
  `result_id` CHAR(36) NOT NULL,
  `rule_id` CHAR(36) NOT NULL,
  `status` ENUM('PENDING','ACKNOWLEDGED','DISMISSED','SUPERSEDED') NOT NULL DEFAULT 'PENDING',
  `trigger_value_snapshot` VARCHAR(1000) NOT NULL,
  `target_test_code_snapshot` VARCHAR(80) NOT NULL,
  `target_test_name_en_snapshot` VARCHAR(220) NOT NULL,
  `target_test_name_ar_snapshot` VARCHAR(220) NULL,
  `reviewed_by_user_id` CHAR(36) NULL,
  `reviewed_at` DATETIME(3) NULL,
  `review_note` VARCHAR(1000) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `reflex_rule_events_result_rule_key`(`result_id`,`rule_id`),
  INDEX `reflex_rule_events_status_created_idx`(`status`,`created_at`),
  INDEX `reflex_rule_events_reviewed_idx`(`reviewed_by_user_id`,`reviewed_at`),
  CONSTRAINT `reflex_rule_events_result_fkey` FOREIGN KEY (`result_id`) REFERENCES `laboratory_results`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `reflex_rule_events_rule_fkey` FOREIGN KEY (`rule_id`) REFERENCES `reflex_rules`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `reflex_rule_events_reviewed_by_fkey` FOREIGN KEY (`reviewed_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT IGNORE INTO `permissions` (`id`,`code`,`module`,`description`,`created_at`) VALUES
(UUID(),'reflex.review','results','Review reflex recommendations generated by clinical rules',CURRENT_TIMESTAMP(3));

INSERT IGNORE INTO `role_permissions` (`role_id`,`permission_id`,`granted_at`)
SELECT r.id, p.id, CURRENT_TIMESTAMP(3)
FROM `roles` r
JOIN `permissions` p ON p.code='reflex.review'
WHERE r.code='SYSTEM_ADMIN';
