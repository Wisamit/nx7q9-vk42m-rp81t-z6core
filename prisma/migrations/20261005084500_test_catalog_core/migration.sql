CREATE TABLE `specimen_types` (
  `id` CHAR(36) NOT NULL, `organization_id` CHAR(36) NOT NULL, `code` VARCHAR(50) NOT NULL, `name_en` VARCHAR(150) NOT NULL, `name_ar` VARCHAR(150) NULL,
  `status` ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE', `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updated_at` DATETIME(3) NOT NULL, `deactivated_at` DATETIME(3) NULL,
  UNIQUE INDEX `specimen_types_organization_id_code_key`(`organization_id`,`code`), PRIMARY KEY(`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE `containers` (
  `id` CHAR(36) NOT NULL, `organization_id` CHAR(36) NOT NULL, `code` VARCHAR(50) NOT NULL, `name_en` VARCHAR(150) NOT NULL, `name_ar` VARCHAR(150) NULL, `tube_color` VARCHAR(80) NULL, `additive` VARCHAR(150) NULL,
  `status` ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE', `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updated_at` DATETIME(3) NOT NULL, `deactivated_at` DATETIME(3) NULL,
  UNIQUE INDEX `containers_organization_id_code_key`(`organization_id`,`code`), PRIMARY KEY(`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE `units` (
  `id` CHAR(36) NOT NULL, `organization_id` CHAR(36) NOT NULL, `code` VARCHAR(50) NOT NULL, `symbol` VARCHAR(50) NOT NULL, `name_en` VARCHAR(150) NULL, `name_ar` VARCHAR(150) NULL, `ucum_code` VARCHAR(50) NULL,
  `status` ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE', `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updated_at` DATETIME(3) NOT NULL, `deactivated_at` DATETIME(3) NULL,
  UNIQUE INDEX `units_organization_id_code_key`(`organization_id`,`code`), PRIMARY KEY(`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE `methods` (
  `id` CHAR(36) NOT NULL, `organization_id` CHAR(36) NOT NULL, `code` VARCHAR(50) NOT NULL, `name_en` VARCHAR(150) NOT NULL, `name_ar` VARCHAR(150) NULL,
  `status` ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE', `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updated_at` DATETIME(3) NOT NULL, `deactivated_at` DATETIME(3) NULL,
  UNIQUE INDEX `methods_organization_id_code_key`(`organization_id`,`code`), PRIMARY KEY(`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE `lab_tests` (
  `id` CHAR(36) NOT NULL, `organization_id` CHAR(36) NOT NULL, `code` VARCHAR(80) NOT NULL, `name_en` VARCHAR(200) NOT NULL, `name_ar` VARCHAR(200) NULL, `abbreviation` VARCHAR(80) NULL,
  `department_id` CHAR(36) NULL, `specimen_type_id` CHAR(36) NULL, `container_id` CHAR(36) NULL, `method_id` CHAR(36) NULL, `default_unit_id` CHAR(36) NULL,
  `result_type` ENUM('NUMERIC','TEXT','QUALITATIVE','BOOLEAN','DATE') NOT NULL DEFAULT 'NUMERIC', `decimal_precision` INTEGER NULL,
  `minimum_volume` DECIMAL(10,3) NULL, `minimum_volume_unit` VARCHAR(30) NULL, `collection_instructions` TEXT NULL, `patient_preparation` TEXT NULL, `storage_conditions` TEXT NULL,
  `stability_minutes` INTEGER NULL, `assay` VARCHAR(200) NULL, `tat_minutes` INTEGER NULL, `loinc_code` VARCHAR(30) NULL, `status` ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updated_at` DATETIME(3) NOT NULL, `deactivated_at` DATETIME(3) NULL,
  UNIQUE INDEX `lab_tests_organization_id_code_key`(`organization_id`,`code`), INDEX `lab_tests_organization_id_status_idx`(`organization_id`,`status`), INDEX `lab_tests_department_id_status_idx`(`department_id`,`status`), PRIMARY KEY(`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE `test_components` (
  `id` CHAR(36) NOT NULL, `test_id` CHAR(36) NOT NULL, `code` VARCHAR(80) NOT NULL, `name_en` VARCHAR(200) NOT NULL, `name_ar` VARCHAR(200) NULL, `unit_id` CHAR(36) NULL,
  `result_type` ENUM('NUMERIC','TEXT','QUALITATIVE','BOOLEAN','DATE') NOT NULL DEFAULT 'NUMERIC', `decimal_precision` INTEGER NULL, `display_order` INTEGER NOT NULL DEFAULT 0,
  `status` ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE', `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updated_at` DATETIME(3) NOT NULL, `deactivated_at` DATETIME(3) NULL,
  UNIQUE INDEX `test_components_test_id_code_key`(`test_id`,`code`), INDEX `test_components_test_id_display_order_idx`(`test_id`,`display_order`), PRIMARY KEY(`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE `test_branch_availability` (
  `test_id` CHAR(36) NOT NULL, `branch_id` CHAR(36) NOT NULL, `status` ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE', `performed_here` BOOLEAN NOT NULL DEFAULT true,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updated_at` DATETIME(3) NOT NULL, INDEX `test_branch_availability_branch_id_status_idx`(`branch_id`,`status`), PRIMARY KEY(`test_id`,`branch_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE `reference_intervals` (
  `id` CHAR(36) NOT NULL, `component_id` CHAR(36) NOT NULL, `branch_id` CHAR(36) NULL, `method_id` CHAR(36) NULL, `sex` ENUM('ANY','MALE','FEMALE') NOT NULL DEFAULT 'ANY',
  `age_from` DECIMAL(10,3) NULL, `age_to` DECIMAL(10,3) NULL, `age_unit` ENUM('DAY','WEEK','MONTH','YEAR') NULL, `low_value` DECIMAL(18,6) NULL, `high_value` DECIMAL(18,6) NULL,
  `normal_text_en` VARCHAR(500) NULL, `normal_text_ar` VARCHAR(500) NULL, `critical_low` DECIMAL(18,6) NULL, `critical_high` DECIMAL(18,6) NULL, `source` VARCHAR(255) NULL, `notes` TEXT NULL,
  `effective_from` DATETIME(3) NOT NULL, `effective_to` DATETIME(3) NULL, `approved_by_user_id` CHAR(36) NULL, `approved_at` DATETIME(3) NULL, `status` ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updated_at` DATETIME(3) NOT NULL,
  INDEX `reference_intervals_component_id_effective_from_effective_to_idx`(`component_id`,`effective_from`,`effective_to`), INDEX `reference_intervals_branch_id_status_idx`(`branch_id`,`status`), PRIMARY KEY(`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `specimen_types` ADD CONSTRAINT `specimen_types_organization_id_fkey` FOREIGN KEY(`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `containers` ADD CONSTRAINT `containers_organization_id_fkey` FOREIGN KEY(`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `units` ADD CONSTRAINT `units_organization_id_fkey` FOREIGN KEY(`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `methods` ADD CONSTRAINT `methods_organization_id_fkey` FOREIGN KEY(`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `lab_tests` ADD CONSTRAINT `lab_tests_organization_id_fkey` FOREIGN KEY(`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `lab_tests` ADD CONSTRAINT `lab_tests_department_id_fkey` FOREIGN KEY(`department_id`) REFERENCES `departments`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `lab_tests` ADD CONSTRAINT `lab_tests_specimen_type_id_fkey` FOREIGN KEY(`specimen_type_id`) REFERENCES `specimen_types`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `lab_tests` ADD CONSTRAINT `lab_tests_container_id_fkey` FOREIGN KEY(`container_id`) REFERENCES `containers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `lab_tests` ADD CONSTRAINT `lab_tests_method_id_fkey` FOREIGN KEY(`method_id`) REFERENCES `methods`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `lab_tests` ADD CONSTRAINT `lab_tests_default_unit_id_fkey` FOREIGN KEY(`default_unit_id`) REFERENCES `units`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `test_components` ADD CONSTRAINT `test_components_test_id_fkey` FOREIGN KEY(`test_id`) REFERENCES `lab_tests`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `test_components` ADD CONSTRAINT `test_components_unit_id_fkey` FOREIGN KEY(`unit_id`) REFERENCES `units`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `test_branch_availability` ADD CONSTRAINT `test_branch_availability_test_id_fkey` FOREIGN KEY(`test_id`) REFERENCES `lab_tests`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `test_branch_availability` ADD CONSTRAINT `test_branch_availability_branch_id_fkey` FOREIGN KEY(`branch_id`) REFERENCES `branches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `reference_intervals` ADD CONSTRAINT `reference_intervals_component_id_fkey` FOREIGN KEY(`component_id`) REFERENCES `test_components`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `reference_intervals` ADD CONSTRAINT `reference_intervals_branch_id_fkey` FOREIGN KEY(`branch_id`) REFERENCES `branches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `reference_intervals` ADD CONSTRAINT `reference_intervals_method_id_fkey` FOREIGN KEY(`method_id`) REFERENCES `methods`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `reference_intervals` ADD CONSTRAINT `reference_intervals_approved_by_user_id_fkey` FOREIGN KEY(`approved_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
