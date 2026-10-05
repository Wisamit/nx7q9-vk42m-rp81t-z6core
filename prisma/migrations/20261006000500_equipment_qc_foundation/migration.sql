CREATE TABLE `equipment` (
  `id` CHAR(36) NOT NULL,
  `organization_id` CHAR(36) NOT NULL,
  `branch_id` CHAR(36) NOT NULL,
  `department_id` CHAR(36) NULL,
  `analyzer_id` CHAR(36) NULL,
  `asset_id` VARCHAR(100) NOT NULL,
  `name` VARCHAR(220) NOT NULL,
  `manufacturer` VARCHAR(150) NULL,
  `model` VARCHAR(150) NULL,
  `serial_number` VARCHAR(150) NULL,
  `installation_date` DATE NULL,
  `warranty_until` DATE NULL,
  `service_vendor` VARCHAR(220) NULL,
  `location_text` VARCHAR(220) NULL,
  `status` ENUM('ACTIVE','OUT_OF_SERVICE','UNDER_MAINTENANCE','RETIRED') NOT NULL DEFAULT 'ACTIVE',
  `notes` TEXT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  `deactivated_at` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `equipment_analyzer_id_key`(`analyzer_id`),
  UNIQUE INDEX `equipment_org_asset_key`(`organization_id`,`asset_id`),
  INDEX `equipment_branch_status_idx`(`branch_id`,`status`),
  INDEX `equipment_department_status_idx`(`department_id`,`status`),
  CONSTRAINT `equipment_org_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `equipment_branch_fkey` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `equipment_department_fkey` FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `equipment_analyzer_fkey` FOREIGN KEY (`analyzer_id`) REFERENCES `analyzers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `equipment_documents` (
  `id` CHAR(36) NOT NULL,
  `equipment_id` CHAR(36) NOT NULL,
  `document_type` VARCHAR(80) NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `storage_key` VARCHAR(500) NULL,
  `external_url` VARCHAR(1000) NULL,
  `expires_at` DATE NULL,
  `notes` VARCHAR(500) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `equipment_documents_equipment_type_idx`(`equipment_id`,`document_type`),
  INDEX `equipment_documents_expires_idx`(`expires_at`),
  CONSTRAINT `equipment_documents_equipment_fkey` FOREIGN KEY (`equipment_id`) REFERENCES `equipment`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `maintenance_plans` (
  `id` CHAR(36) NOT NULL,
  `equipment_id` CHAR(36) NOT NULL,
  `name` VARCHAR(220) NOT NULL,
  `frequency_days` INT NOT NULL,
  `next_due_at` DATE NOT NULL,
  `instructions` TEXT NULL,
  `status` ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  `deactivated_at` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  INDEX `maintenance_plans_equipment_status_due_idx`(`equipment_id`,`status`,`next_due_at`),
  CONSTRAINT `maintenance_plans_equipment_fkey` FOREIGN KEY (`equipment_id`) REFERENCES `equipment`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `maintenance_events` (
  `id` CHAR(36) NOT NULL,
  `equipment_id` CHAR(36) NOT NULL,
  `analyzer_id` CHAR(36) NULL,
  `maintenance_plan_id` CHAR(36) NULL,
  `maintenance_type` ENUM('PREVENTIVE','CORRECTIVE') NOT NULL,
  `status` ENUM('SCHEDULED','IN_PROGRESS','COMPLETED','CANCELLED') NOT NULL DEFAULT 'SCHEDULED',
  `scheduled_at` DATETIME(3) NULL,
  `started_at` DATETIME(3) NULL,
  `completed_at` DATETIME(3) NULL,
  `vendor_engineer` VARCHAR(220) NULL,
  `work_performed` TEXT NULL,
  `corrective_action` TEXT NULL,
  `cost` DECIMAL(18,4) NULL,
  `currency` CHAR(3) NULL,
  `performed_by_user_id` CHAR(36) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `maintenance_events_equipment_status_scheduled_idx`(`equipment_id`,`status`,`scheduled_at`),
  INDEX `maintenance_events_analyzer_completed_idx`(`analyzer_id`,`completed_at`),
  CONSTRAINT `maintenance_events_equipment_fkey` FOREIGN KEY (`equipment_id`) REFERENCES `equipment`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `maintenance_events_analyzer_fkey` FOREIGN KEY (`analyzer_id`) REFERENCES `analyzers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `maintenance_events_plan_fkey` FOREIGN KEY (`maintenance_plan_id`) REFERENCES `maintenance_plans`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `maintenance_events_performed_by_fkey` FOREIGN KEY (`performed_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `calibration_events` (
  `id` CHAR(36) NOT NULL,
  `equipment_id` CHAR(36) NOT NULL,
  `analyzer_id` CHAR(36) NULL,
  `material_name` VARCHAR(220) NULL,
  `material_lot` VARCHAR(120) NULL,
  `due_at` DATE NULL,
  `performed_at` DATETIME(3) NULL,
  `result_summary` TEXT NULL,
  `status` ENUM('DUE','IN_PROGRESS','PASS','FAIL','CANCELLED') NOT NULL DEFAULT 'DUE',
  `performed_by_user_id` CHAR(36) NULL,
  `approved_by_user_id` CHAR(36) NULL,
  `approved_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `calibration_events_equipment_status_due_idx`(`equipment_id`,`status`,`due_at`),
  INDEX `calibration_events_analyzer_status_idx`(`analyzer_id`,`status`),
  CONSTRAINT `calibration_events_equipment_fkey` FOREIGN KEY (`equipment_id`) REFERENCES `equipment`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `calibration_events_analyzer_fkey` FOREIGN KEY (`analyzer_id`) REFERENCES `analyzers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `calibration_events_performed_by_fkey` FOREIGN KEY (`performed_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `calibration_events_approved_by_fkey` FOREIGN KEY (`approved_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `equipment_downtime` (
  `id` CHAR(36) NOT NULL,
  `equipment_id` CHAR(36) NOT NULL,
  `analyzer_id` CHAR(36) NULL,
  `status` ENUM('OPEN','CLOSED') NOT NULL DEFAULT 'OPEN',
  `started_at` DATETIME(3) NOT NULL,
  `ended_at` DATETIME(3) NULL,
  `reason` VARCHAR(1000) NOT NULL,
  `impact` VARCHAR(1000) NULL,
  `resolution` VARCHAR(1000) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `equipment_downtime_equipment_status_started_idx`(`equipment_id`,`status`,`started_at`),
  INDEX `equipment_downtime_analyzer_status_idx`(`analyzer_id`,`status`),
  CONSTRAINT `equipment_downtime_equipment_fkey` FOREIGN KEY (`equipment_id`) REFERENCES `equipment`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `equipment_downtime_analyzer_fkey` FOREIGN KEY (`analyzer_id`) REFERENCES `analyzers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `qc_materials` (
  `id` CHAR(36) NOT NULL,
  `organization_id` CHAR(36) NOT NULL,
  `code` VARCHAR(80) NOT NULL,
  `name_en` VARCHAR(220) NOT NULL,
  `name_ar` VARCHAR(220) NULL,
  `manufacturer` VARCHAR(150) NULL,
  `level_name` VARCHAR(100) NOT NULL,
  `status` ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  `deactivated_at` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `qc_materials_org_code_key`(`organization_id`,`code`),
  INDEX `qc_materials_org_status_idx`(`organization_id`,`status`),
  CONSTRAINT `qc_materials_org_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `qc_lots` (
  `id` CHAR(36) NOT NULL,
  `organization_id` CHAR(36) NOT NULL,
  `material_id` CHAR(36) NOT NULL,
  `inventory_lot_id` CHAR(36) NULL,
  `lot_number` VARCHAR(120) NOT NULL,
  `received_at` DATE NULL,
  `opened_at` DATE NULL,
  `expiry_date` DATE NULL,
  `status` ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  `deactivated_at` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `qc_lots_org_material_lot_key`(`organization_id`,`material_id`,`lot_number`),
  INDEX `qc_lots_material_status_expiry_idx`(`material_id`,`status`,`expiry_date`),
  INDEX `qc_lots_inventory_lot_idx`(`inventory_lot_id`),
  CONSTRAINT `qc_lots_org_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `qc_lots_material_fkey` FOREIGN KEY (`material_id`) REFERENCES `qc_materials`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `qc_lots_inventory_lot_fkey` FOREIGN KEY (`inventory_lot_id`) REFERENCES `inventory_lots`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `qc_targets` (
  `id` CHAR(36) NOT NULL,
  `organization_id` CHAR(36) NOT NULL,
  `analyzer_id` CHAR(36) NOT NULL,
  `test_id` CHAR(36) NOT NULL,
  `component_id` CHAR(36) NULL,
  `target_mean` DECIMAL(24,8) NOT NULL,
  `target_sd` DECIMAL(24,8) NOT NULL,
  `target_cv` DECIMAL(18,6) NULL,
  `unit_snapshot` VARCHAR(80) NULL,
  `enabled_rules` JSON NOT NULL,
  `qc_valid_hours` INT NOT NULL DEFAULT 24,
  `effective_from` DATETIME(3) NOT NULL,
  `effective_to` DATETIME(3) NULL,
  `status` ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  `deactivated_at` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  INDEX `qc_targets_analyzer_test_component_status_dates_idx`(`analyzer_id`,`test_id`,`component_id`,`status`,`effective_from`,`effective_to`),
  INDEX `qc_targets_lot_status_idx`(`qc_lot_id`,`status`),
  CONSTRAINT `qc_targets_org_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `qc_targets_lot_fkey` FOREIGN KEY (`qc_lot_id`) REFERENCES `qc_lots`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `qc_targets_analyzer_fkey` FOREIGN KEY (`analyzer_id`) REFERENCES `analyzers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `qc_targets_test_fkey` FOREIGN KEY (`test_id`) REFERENCES `lab_tests`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `qc_targets_component_fkey` FOREIGN KEY (`component_id`) REFERENCES `test_components`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `qc_runs` (
  `id` CHAR(36) NOT NULL,
  `organization_id` CHAR(36) NOT NULL,
  `branch_id` CHAR(36) NOT NULL,
  `analyzer_id` CHAR(36) NOT NULL,
  `status` ENUM('PENDING','PASS','WARN','FAIL','CANCELLED') NOT NULL DEFAULT 'PENDING',
  `run_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `operator_user_id` CHAR(36) NOT NULL,
  `notes` TEXT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `qc_runs_analyzer_run_at_idx`(`analyzer_id`,`run_at`),
  INDEX `qc_runs_branch_status_run_at_idx`(`branch_id`,`status`,`run_at`),
  CONSTRAINT `qc_runs_org_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `qc_runs_branch_fkey` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `qc_runs_analyzer_fkey` FOREIGN KEY (`analyzer_id`) REFERENCES `analyzers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `qc_runs_operator_fkey` FOREIGN KEY (`operator_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `qc_results` (
  `id` CHAR(36) NOT NULL,
  `qc_run_id` CHAR(36) NOT NULL,
  `target_id` CHAR(36) NOT NULL,
  `observed_value` DECIMAL(24,8) NOT NULL,
  `target_mean_snapshot` DECIMAL(24,8) NOT NULL,
  `target_sd_snapshot` DECIMAL(24,8) NOT NULL,
  `target_cv_snapshot` DECIMAL(18,6) NULL,
  `z_score` DECIMAL(18,6) NOT NULL,
  `status` ENUM('PASS','WARN','FAIL') NOT NULL,
  `evaluated_rules` JSON NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `qc_results_run_target_key`(`qc_run_id`,`target_id`),
  INDEX `qc_results_target_created_idx`(`target_id`,`created_at`),
  INDEX `qc_results_status_created_idx`(`status`,`created_at`),
  CONSTRAINT `qc_results_run_fkey` FOREIGN KEY (`qc_run_id`) REFERENCES `qc_runs`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `qc_results_target_fkey` FOREIGN KEY (`target_id`) REFERENCES `qc_targets`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `qc_rule_violations` (
  `id` CHAR(36) NOT NULL,
  `qc_run_id` CHAR(36) NOT NULL,
  `target_id` CHAR(36) NOT NULL,
  `rule_code` VARCHAR(40) NOT NULL,
  `severity` ENUM('WARNING','BLOCK') NOT NULL,
  `status` ENUM('OPEN','RESOLVED','SUPERSEDED') NOT NULL DEFAULT 'OPEN',
  `details` JSON NOT NULL,
  `detected_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `resolved_by_user_id` CHAR(36) NULL,
  `resolved_at` DATETIME(3) NULL,
  `resolution_note` VARCHAR(1000) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `qc_rule_violations_run_target_rule_key`(`qc_run_id`,`target_id`,`rule_code`),
  INDEX `qc_rule_violations_target_status_detected_idx`(`target_id`,`status`,`detected_at`),
  INDEX `qc_rule_violations_status_severity_detected_idx`(`status`,`severity`,`detected_at`),
  CONSTRAINT `qc_rule_violations_run_fkey` FOREIGN KEY (`qc_run_id`) REFERENCES `qc_runs`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `qc_rule_violations_target_fkey` FOREIGN KEY (`target_id`) REFERENCES `qc_targets`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `qc_rule_violations_resolver_fkey` FOREIGN KEY (`resolved_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `qc_actions` (
  `id` CHAR(36) NOT NULL,
  `violation_id` CHAR(36) NOT NULL,
  `action_type` ENUM('REPEAT_QC','RECALIBRATE','MAINTENANCE','REPLACE_REAGENT','REPLACE_CONTROL','INVESTIGATE','OTHER') NOT NULL,
  `description` VARCHAR(1000) NOT NULL,
  `performed_by_user_id` CHAR(36) NOT NULL,
  `performed_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `qc_actions_violation_performed_idx`(`violation_id`,`performed_at`),
  CONSTRAINT `qc_actions_violation_fkey` FOREIGN KEY (`violation_id`) REFERENCES `qc_rule_violations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `qc_actions_performer_fkey` FOREIGN KEY (`performed_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT IGNORE INTO `permissions` (`id`,`code`,`module`,`description`,`created_at`) VALUES
(UUID(),'equipment.view','equipment','View equipment, maintenance, calibration and downtime',CURRENT_TIMESTAMP(3)),
(UUID(),'equipment.manage','equipment','Manage equipment register and service events',CURRENT_TIMESTAMP(3)),
(UUID(),'qc.view','quality','View quality control configuration, runs and violations',CURRENT_TIMESTAMP(3)),
(UUID(),'qc.manage','quality','Manage QC materials, lots, targets and rules',CURRENT_TIMESTAMP(3)),
(UUID(),'qc.enter','quality','Enter and evaluate quality control runs',CURRENT_TIMESTAMP(3)),
(UUID(),'qc.resolve','quality','Document QC corrective actions and resolve violations',CURRENT_TIMESTAMP(3));

INSERT IGNORE INTO `role_permissions` (`role_id`,`permission_id`,`granted_at`)
SELECT r.id, p.id, CURRENT_TIMESTAMP(3)
FROM `roles` r
JOIN `permissions` p ON p.code IN ('equipment.view','equipment.manage','qc.view','qc.manage','qc.enter','qc.resolve')
WHERE r.code='SYSTEM_ADMIN';
