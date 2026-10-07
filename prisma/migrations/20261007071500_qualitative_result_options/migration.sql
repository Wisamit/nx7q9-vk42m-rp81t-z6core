ALTER TABLE `laboratory_result_values`
  MODIFY COLUMN `flag` ENUM('NORMAL','LOW','HIGH','CRITICAL_LOW','CRITICAL_HIGH','ABNORMAL','POSITIVE','NEGATIVE','UNKNOWN') NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN `flag_source` ENUM('NONE','REFERENCE_INTERVAL','RESULT_OPTION','ANALYZER','MANUAL') NOT NULL DEFAULT 'NONE' AFTER `flag`,
  ADD COLUMN `qualitative_option_id` CHAR(36) NULL AFTER `is_critical`,
  ADD COLUMN `qualitative_option_code_snapshot` VARCHAR(80) NULL AFTER `qualitative_option_id`,
  ADD COLUMN `value_text_en_snapshot` VARCHAR(500) NULL AFTER `qualitative_option_code_snapshot`,
  ADD COLUMN `value_text_ar_snapshot` VARCHAR(500) NULL AFTER `value_text_en_snapshot`;

CREATE TABLE `qualitative_result_options` (
  `id` CHAR(36) NOT NULL,
  `organization_id` CHAR(36) NOT NULL,
  `test_id` CHAR(36) NOT NULL,
  `component_id` CHAR(36) NULL,
  `code` VARCHAR(80) NOT NULL,
  `value_en` VARCHAR(500) NOT NULL,
  `value_ar` VARCHAR(500) NULL,
  `flag` ENUM('NORMAL','LOW','HIGH','CRITICAL_LOW','CRITICAL_HIGH','ABNORMAL','POSITIVE','NEGATIVE','UNKNOWN') NOT NULL DEFAULT 'UNKNOWN',
  `is_critical` BOOLEAN NOT NULL DEFAULT false,
  `display_order` INTEGER NOT NULL DEFAULT 0,
  `effective_from` DATETIME(3) NOT NULL,
  `effective_to` DATETIME(3) NULL,
  `status` ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  `created_by_user_id` CHAR(36) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  `deactivated_at` DATETIME(3) NULL,

  INDEX `qualitative_result_options_organization_id_status_idx`(`organization_id`, `status`),
  INDEX `qualitative_result_options_test_id_component_id_status_effective_from_effective_to_idx`(`test_id`, `component_id`, `status`, `effective_from`, `effective_to`),
  INDEX `qualitative_result_options_created_by_user_id_created_at_idx`(`created_by_user_id`, `created_at`),
  PRIMARY KEY (`id`),

  CONSTRAINT `qualitative_result_options_organization_id_fkey`
    FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `qualitative_result_options_test_id_fkey`
    FOREIGN KEY (`test_id`) REFERENCES `lab_tests`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `qualitative_result_options_component_id_fkey`
    FOREIGN KEY (`component_id`) REFERENCES `test_components`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `qualitative_result_options_created_by_user_id_fkey`
    FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `laboratory_result_values`
  ADD INDEX `laboratory_result_values_qualitative_option_id_idx`(`qualitative_option_id`),
  ADD CONSTRAINT `laboratory_result_values_qualitative_option_id_fkey`
    FOREIGN KEY (`qualitative_option_id`) REFERENCES `qualitative_result_options`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
