ALTER TABLE `lab_tests`
  ADD COLUMN `result_entry_layout` ENUM('STANDARD','SECTIONED','COMPACT_GRID') NOT NULL DEFAULT 'STANDARD' AFTER `workflow_type`;

CREATE TABLE `test_result_sections` (
  `id` CHAR(36) NOT NULL,
  `test_id` CHAR(36) NOT NULL,
  `code` VARCHAR(80) NOT NULL,
  `name_en` VARCHAR(200) NOT NULL,
  `name_ar` VARCHAR(200) NULL,
  `display_order` INT NOT NULL DEFAULT 0,
  `status` ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  `deactivated_at` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `test_result_sections_test_code_key`(`test_id`, `code`),
  INDEX `test_result_sections_test_status_order_idx`(`test_id`, `status`, `display_order`),
  CONSTRAINT `test_result_sections_test_fk` FOREIGN KEY (`test_id`) REFERENCES `lab_tests`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `test_components`
  ADD COLUMN `result_section_id` CHAR(36) NULL AFTER `display_order`,
  ADD INDEX `test_components_result_section_idx`(`result_section_id`),
  ADD CONSTRAINT `test_components_result_section_fk` FOREIGN KEY (`result_section_id`) REFERENCES `test_result_sections`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
