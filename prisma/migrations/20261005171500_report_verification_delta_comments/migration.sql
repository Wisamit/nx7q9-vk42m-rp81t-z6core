ALTER TABLE `laboratory_result_values`
  ADD COLUMN `delta_evaluation` ENUM('NOT_CONFIGURED','NO_PREVIOUS_RESULT','WITHIN_LIMIT','EXCEEDED') NOT NULL DEFAULT 'NOT_CONFIGURED' AFTER `is_critical`,
  ADD COLUMN `previous_value_snapshot` DECIMAL(24,8) NULL AFTER `delta_evaluation`,
  ADD COLUMN `previous_result_at_snapshot` DATETIME(3) NULL AFTER `previous_value_snapshot`,
  ADD COLUMN `delta_absolute_snapshot` DECIMAL(24,8) NULL AFTER `previous_result_at_snapshot`,
  ADD COLUMN `delta_percent_snapshot` DECIMAL(18,6) NULL AFTER `delta_absolute_snapshot`,
  ADD COLUMN `delta_absolute_limit_snapshot` DECIMAL(24,8) NULL AFTER `delta_percent_snapshot`,
  ADD COLUMN `delta_percent_limit_snapshot` DECIMAL(18,6) NULL AFTER `delta_absolute_limit_snapshot`;

CREATE TABLE `delta_rules` (
  `id` CHAR(36) NOT NULL,
  `organization_id` CHAR(36) NOT NULL,
  `test_id` CHAR(36) NOT NULL,
  `component_id` CHAR(36) NULL,
  `branch_id` CHAR(36) NULL,
  `method_id` CHAR(36) NULL,
  `absolute_limit` DECIMAL(24,8) NULL,
  `percent_limit` DECIMAL(18,6) NULL,
  `lookback_days` INT NOT NULL DEFAULT 365,
  `effective_from` DATETIME(3) NOT NULL,
  `effective_to` DATETIME(3) NULL,
  `status` ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  `deactivated_at` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  INDEX `delta_rules_test_component_status_dates_idx`(`test_id`,`component_id`,`status`,`effective_from`,`effective_to`),
  INDEX `delta_rules_branch_status_idx`(`branch_id`,`status`),
  INDEX `delta_rules_method_status_idx`(`method_id`,`status`),
  CONSTRAINT `delta_rules_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `delta_rules_test_id_fkey` FOREIGN KEY (`test_id`) REFERENCES `lab_tests`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `delta_rules_component_id_fkey` FOREIGN KEY (`component_id`) REFERENCES `test_components`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `delta_rules_branch_id_fkey` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `delta_rules_method_id_fkey` FOREIGN KEY (`method_id`) REFERENCES `methods`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `result_comment_templates` (
  `id` CHAR(36) NOT NULL,
  `organization_id` CHAR(36) NOT NULL,
  `scope` ENUM('ORGANIZATION','TEST','COMPONENT') NOT NULL DEFAULT 'ORGANIZATION',
  `test_id` CHAR(36) NULL,
  `component_id` CHAR(36) NULL,
  `code` VARCHAR(80) NOT NULL,
  `name_en` VARCHAR(220) NOT NULL,
  `name_ar` VARCHAR(220) NULL,
  `text_en` TEXT NOT NULL,
  `text_ar` TEXT NULL,
  `status` ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  `deactivated_at` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `result_comment_templates_org_code_key`(`organization_id`,`code`),
  INDEX `result_comment_templates_test_status_idx`(`test_id`,`status`),
  INDEX `result_comment_templates_component_status_idx`(`component_id`,`status`),
  CONSTRAINT `result_comment_templates_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `result_comment_templates_test_id_fkey` FOREIGN KEY (`test_id`) REFERENCES `lab_tests`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `result_comment_templates_component_id_fkey` FOREIGN KEY (`component_id`) REFERENCES `test_components`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `report_delivery_events` (
  `id` CHAR(36) NOT NULL,
  `report_version_id` CHAR(36) NOT NULL,
  `channel` ENUM('PRINT','DOWNLOAD','EMAIL','SMS','WHATSAPP','PORTAL','OTHER') NOT NULL,
  `status` ENUM('RECORDED','QUEUED','SENT','DELIVERED','FAILED') NOT NULL DEFAULT 'RECORDED',
  `recipient` VARCHAR(255) NULL,
  `external_ref` VARCHAR(255) NULL,
  `details` JSON NULL,
  `performed_by_user_id` CHAR(36) NULL,
  `occurred_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `report_delivery_events_version_time_idx`(`report_version_id`,`occurred_at`),
  INDEX `report_delivery_events_user_time_idx`(`performed_by_user_id`,`occurred_at`),
  CONSTRAINT `report_delivery_events_version_id_fkey` FOREIGN KEY (`report_version_id`) REFERENCES `diagnostic_report_versions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `report_delivery_events_user_id_fkey` FOREIGN KEY (`performed_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT IGNORE INTO `permissions` (`id`,`code`,`module`,`description`,`created_at`) VALUES
(UUID(),'clinical_rules.manage','results','Manage delta-check and other clinical rules',CURRENT_TIMESTAMP(3)),
(UUID(),'result_comments.manage','results','Manage reusable result comment templates',CURRENT_TIMESTAMP(3)),
(UUID(),'reports.deliver','reporting','Record and perform report delivery actions',CURRENT_TIMESTAMP(3));

INSERT IGNORE INTO `role_permissions` (`role_id`,`permission_id`,`granted_at`)
SELECT r.id, p.id, CURRENT_TIMESTAMP(3)
FROM `roles` r
JOIN `permissions` p ON p.code IN ('clinical_rules.manage','result_comments.manage','reports.deliver')
WHERE r.code='SYSTEM_ADMIN';
