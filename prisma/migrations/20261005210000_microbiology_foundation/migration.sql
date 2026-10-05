ALTER TABLE `lab_tests`
  ADD COLUMN `workflow_type` ENUM('GENERAL','MICROBIOLOGY') NOT NULL DEFAULT 'GENERAL' AFTER `result_type`;

CREATE TABLE `organisms` (
  `id` CHAR(36) NOT NULL, `organization_id` CHAR(36) NOT NULL, `code` VARCHAR(80) NOT NULL,
  `name_en` VARCHAR(220) NOT NULL, `name_ar` VARCHAR(220) NULL, `category` VARCHAR(120) NULL,
  `status` ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE', `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL, `deactivated_at` DATETIME(3) NULL,
  PRIMARY KEY (`id`), UNIQUE INDEX `organisms_org_code_key`(`organization_id`,`code`),
  INDEX `organisms_org_status_name_idx`(`organization_id`,`status`,`name_en`),
  CONSTRAINT `organisms_org_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `antibiotics` (
  `id` CHAR(36) NOT NULL, `organization_id` CHAR(36) NOT NULL, `code` VARCHAR(80) NOT NULL,
  `name_en` VARCHAR(220) NOT NULL, `name_ar` VARCHAR(220) NULL, `drug_class` VARCHAR(150) NULL,
  `status` ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE', `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL, `deactivated_at` DATETIME(3) NULL,
  PRIMARY KEY (`id`), UNIQUE INDEX `antibiotics_org_code_key`(`organization_id`,`code`),
  INDEX `antibiotics_org_status_name_idx`(`organization_id`,`status`,`name_en`),
  CONSTRAINT `antibiotics_org_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `microbiology_cases` (
  `id` CHAR(36) NOT NULL, `organization_id` CHAR(36) NOT NULL, `order_item_id` CHAR(36) NOT NULL,
  `specimen_id` CHAR(36) NOT NULL, `performing_branch_id` CHAR(36) NOT NULL, `result_id` CHAR(36) NULL,
  `status` ENUM('DRAFT','IN_PROGRESS','PRELIMINARY','FINAL','CANCELLED') NOT NULL DEFAULT 'DRAFT',
  `culture_status` ENUM('PENDING','NO_GROWTH','GROWTH','MIXED_GROWTH','CONTAMINATED','FINAL') NOT NULL DEFAULT 'PENDING',
  `preliminary_comment` TEXT NULL, `final_comment` TEXT NULL, `created_by_user_id` CHAR(36) NOT NULL,
  `finalized_by_user_id` CHAR(36) NULL, `finalized_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`), UNIQUE INDEX `microbiology_cases_result_key`(`result_id`),
  UNIQUE INDEX `microbiology_cases_order_item_specimen_key`(`order_item_id`,`specimen_id`),
  INDEX `microbiology_cases_branch_status_created_idx`(`performing_branch_id`,`status`,`created_at`),
  INDEX `microbiology_cases_org_culture_created_idx`(`organization_id`,`culture_status`,`created_at`),
  CONSTRAINT `microbiology_cases_org_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `microbiology_cases_order_item_fkey` FOREIGN KEY (`order_item_id`) REFERENCES `order_items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `microbiology_cases_specimen_fkey` FOREIGN KEY (`specimen_id`) REFERENCES `specimens`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `microbiology_cases_branch_fkey` FOREIGN KEY (`performing_branch_id`) REFERENCES `branches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `microbiology_cases_result_fkey` FOREIGN KEY (`result_id`) REFERENCES `laboratory_results`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `microbiology_cases_creator_fkey` FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `microbiology_cases_finalizer_fkey` FOREIGN KEY (`finalized_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `culture_observations` (
  `id` CHAR(36) NOT NULL, `case_id` CHAR(36) NOT NULL,
  `observation_type` ENUM('GRAM_STAIN','MICROSCOPY','CULTURE','COLONY_COUNT','OTHER') NOT NULL,
  `observation_text` TEXT NOT NULL, `entered_by_user_id` CHAR(36) NOT NULL,
  `observed_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`), INDEX `culture_observations_case_observed_idx`(`case_id`,`observed_at`),
  CONSTRAINT `culture_observations_case_fkey` FOREIGN KEY (`case_id`) REFERENCES `microbiology_cases`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `culture_observations_user_fkey` FOREIGN KEY (`entered_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `microbiology_isolates` (
  `id` CHAR(36) NOT NULL, `case_id` CHAR(36) NOT NULL, `organism_id` CHAR(36) NOT NULL,
  `sequence_number` INT NOT NULL DEFAULT 1, `quantity_text` VARCHAR(200) NULL, `colony_notes` TEXT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`), UNIQUE INDEX `microbiology_isolates_case_sequence_key`(`case_id`,`sequence_number`),
  INDEX `microbiology_isolates_organism_idx`(`organism_id`),
  CONSTRAINT `microbiology_isolates_case_fkey` FOREIGN KEY (`case_id`) REFERENCES `microbiology_cases`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `microbiology_isolates_organism_fkey` FOREIGN KEY (`organism_id`) REFERENCES `organisms`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `susceptibility_tests` (
  `id` CHAR(36) NOT NULL, `isolate_id` CHAR(36) NOT NULL, `method` VARCHAR(150) NULL, `comments` TEXT NULL,
  `entered_by_user_id` CHAR(36) NOT NULL, `tested_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`), INDEX `susceptibility_tests_isolate_tested_idx`(`isolate_id`,`tested_at`),
  CONSTRAINT `susceptibility_tests_isolate_fkey` FOREIGN KEY (`isolate_id`) REFERENCES `microbiology_isolates`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `susceptibility_tests_user_fkey` FOREIGN KEY (`entered_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `susceptibility_results` (
  `id` CHAR(36) NOT NULL, `susceptibility_test_id` CHAR(36) NOT NULL, `antibiotic_id` CHAR(36) NOT NULL,
  `antibiotic_code_snapshot` VARCHAR(80) NOT NULL, `antibiotic_name_en_snapshot` VARCHAR(220) NOT NULL,
  `antibiotic_name_ar_snapshot` VARCHAR(220) NULL,
  `interpretation` ENUM('S','I','R','NON_SUSCEPTIBLE','UNKNOWN') NOT NULL DEFAULT 'UNKNOWN',
  `mic_value` DECIMAL(18,6) NULL, `mic_unit` VARCHAR(40) NULL, `zone_diameter_mm` DECIMAL(10,3) NULL,
  `breakpoint_snapshot` VARCHAR(255) NULL, `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`), UNIQUE INDEX `susceptibility_results_test_antibiotic_key`(`susceptibility_test_id`,`antibiotic_id`),
  INDEX `susceptibility_results_antibiotic_interpretation_idx`(`antibiotic_id`,`interpretation`),
  CONSTRAINT `susceptibility_results_test_fkey` FOREIGN KEY (`susceptibility_test_id`) REFERENCES `susceptibility_tests`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `susceptibility_results_antibiotic_fkey` FOREIGN KEY (`antibiotic_id`) REFERENCES `antibiotics`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT IGNORE INTO `permissions` (`id`,`code`,`module`,`description`,`created_at`) VALUES
(UUID(),'microbiology.view','microbiology','View microbiology cases and susceptibility results',CURRENT_TIMESTAMP(3)),
(UUID(),'microbiology.enter','microbiology','Enter microbiology observations, isolates and susceptibility results',CURRENT_TIMESTAMP(3)),
(UUID(),'microbiology.manage','microbiology','Manage microbiology organism and antibiotic master data',CURRENT_TIMESTAMP(3));

INSERT IGNORE INTO `role_permissions` (`role_id`,`permission_id`,`granted_at`)
SELECT r.id, p.id, CURRENT_TIMESTAMP(3) FROM `roles` r JOIN `permissions` p ON p.code IN ('microbiology.view','microbiology.enter','microbiology.manage') WHERE r.code='SYSTEM_ADMIN';
