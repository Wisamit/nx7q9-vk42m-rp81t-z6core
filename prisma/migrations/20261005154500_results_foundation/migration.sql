CREATE TABLE `laboratory_results` (
  `id` CHAR(36) NOT NULL,
  `organization_id` CHAR(36) NOT NULL,
  `order_item_id` CHAR(36) NOT NULL,
  `specimen_id` CHAR(36) NULL,
  `performing_branch_id` CHAR(36) NOT NULL,
  `method_id` CHAR(36) NULL,
  `version` INT NOT NULL DEFAULT 1,
  `status` ENUM('DRAFT','ENTERED','VERIFIED','RELEASED','AMENDED','CANCELLED') NOT NULL DEFAULT 'DRAFT',
  `source` ENUM('MANUAL','ANALYZER','IMPORT','CALCULATED') NOT NULL DEFAULT 'MANUAL',
  `entered_by_user_id` CHAR(36) NOT NULL,
  `entered_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `verified_by_user_id` CHAR(36) NULL,
  `verified_at` DATETIME(3) NULL,
  `released_at` DATETIME(3) NULL,
  `amended_from_id` CHAR(36) NULL,
  `amendment_reason` VARCHAR(1000) NULL,
  `comments` TEXT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `laboratory_results_order_item_version_key`(`order_item_id`,`version`),
  INDEX `laboratory_results_branch_status_entered_idx`(`performing_branch_id`,`status`,`entered_at`),
  INDEX `laboratory_results_specimen_status_idx`(`specimen_id`,`status`),
  INDEX `laboratory_results_order_item_status_idx`(`order_item_id`,`status`),
  CONSTRAINT `laboratory_results_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `laboratory_results_order_item_id_fkey` FOREIGN KEY (`order_item_id`) REFERENCES `order_items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `laboratory_results_specimen_id_fkey` FOREIGN KEY (`specimen_id`) REFERENCES `specimens`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `laboratory_results_performing_branch_id_fkey` FOREIGN KEY (`performing_branch_id`) REFERENCES `branches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `laboratory_results_method_id_fkey` FOREIGN KEY (`method_id`) REFERENCES `methods`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `laboratory_results_entered_by_user_id_fkey` FOREIGN KEY (`entered_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `laboratory_results_verified_by_user_id_fkey` FOREIGN KEY (`verified_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `laboratory_results_amended_from_id_fkey` FOREIGN KEY (`amended_from_id`) REFERENCES `laboratory_results`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `laboratory_result_values` (
  `id` CHAR(36) NOT NULL,
  `result_id` CHAR(36) NOT NULL,
  `component_id` CHAR(36) NULL,
  `component_code_snapshot` VARCHAR(80) NOT NULL,
  `component_name_en_snapshot` VARCHAR(220) NOT NULL,
  `component_name_ar_snapshot` VARCHAR(220) NULL,
  `result_type_snapshot` ENUM('NUMERIC','TEXT','QUALITATIVE','BOOLEAN','DATE') NOT NULL,
  `value_numeric` DECIMAL(24,8) NULL,
  `value_text` TEXT NULL,
  `value_boolean` BOOLEAN NULL,
  `value_date` DATETIME(3) NULL,
  `display_value` VARCHAR(1000) NOT NULL,
  `unit_id` CHAR(36) NULL,
  `unit_snapshot` VARCHAR(80) NULL,
  `reference_interval_id` CHAR(36) NULL,
  `reference_low_snapshot` DECIMAL(18,6) NULL,
  `reference_high_snapshot` DECIMAL(18,6) NULL,
  `reference_text_en_snapshot` VARCHAR(500) NULL,
  `reference_text_ar_snapshot` VARCHAR(500) NULL,
  `critical_low_snapshot` DECIMAL(18,6) NULL,
  `critical_high_snapshot` DECIMAL(18,6) NULL,
  `flag` ENUM('NORMAL','LOW','HIGH','CRITICAL_LOW','CRITICAL_HIGH','ABNORMAL','UNKNOWN') NOT NULL DEFAULT 'UNKNOWN',
  `is_critical` BOOLEAN NOT NULL DEFAULT false,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `laboratory_result_values_result_component_code_key`(`result_id`,`component_code_snapshot`),
  INDEX `laboratory_result_values_component_idx`(`component_id`),
  INDEX `laboratory_result_values_flag_critical_idx`(`flag`,`is_critical`),
  CONSTRAINT `laboratory_result_values_result_id_fkey` FOREIGN KEY (`result_id`) REFERENCES `laboratory_results`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `laboratory_result_values_component_id_fkey` FOREIGN KEY (`component_id`) REFERENCES `test_components`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `laboratory_result_values_unit_id_fkey` FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `laboratory_result_values_reference_interval_id_fkey` FOREIGN KEY (`reference_interval_id`) REFERENCES `reference_intervals`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;


INSERT IGNORE INTO `permissions` (`id`,`code`,`module`,`description`,`created_at`) VALUES
(UUID(),'worklists.view','laboratory','View laboratory worklists',CURRENT_TIMESTAMP(3)),
(UUID(),'results.enter','results','Enter and save laboratory results',CURRENT_TIMESTAMP(3)),
(UUID(),'results.verify','results','Verify laboratory results',CURRENT_TIMESTAMP(3));

INSERT IGNORE INTO `role_permissions` (`role_id`,`permission_id`,`granted_at`)
SELECT r.id, p.id, CURRENT_TIMESTAMP(3)
FROM `roles` r
JOIN `permissions` p ON p.code IN ('worklists.view','results.enter','results.verify')
WHERE r.code='SYSTEM_ADMIN';
