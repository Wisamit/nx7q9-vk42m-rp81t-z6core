ALTER TABLE `laboratory_results`
  ADD COLUMN `analyzer_id` CHAR(36) NULL AFTER `method_id`,
  ADD COLUMN `analyzer_code_snapshot` VARCHAR(80) NULL AFTER `analyzer_id`,
  ADD COLUMN `analyzer_name_snapshot` VARCHAR(200) NULL AFTER `analyzer_code_snapshot`,
  ADD INDEX `laboratory_results_analyzer_status_idx`(`analyzer_id`,`status`),
  ADD CONSTRAINT `laboratory_results_analyzer_fkey` FOREIGN KEY (`analyzer_id`) REFERENCES `analyzers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `laboratory_result_values`
  ADD COLUMN `analyzer_import_id` CHAR(36) NULL AFTER `calculation_inputs_snapshot`,
  ADD INDEX `laboratory_result_values_analyzer_import_idx`(`analyzer_import_id`),
  ADD CONSTRAINT `laboratory_result_values_analyzer_import_fkey` FOREIGN KEY (`analyzer_import_id`) REFERENCES `analyzer_result_imports`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT IGNORE INTO `permissions` (`id`,`code`,`module`,`description`,`created_at`) VALUES
(UUID(),'analyzers.import','integrations','Import mapped analyzer observations into laboratory results',CURRENT_TIMESTAMP(3));

INSERT IGNORE INTO `role_permissions` (`role_id`,`permission_id`,`granted_at`)
SELECT r.id, p.id, CURRENT_TIMESTAMP(3)
FROM `roles` r
JOIN `permissions` p ON p.code='analyzers.import'
WHERE r.code='SYSTEM_ADMIN';
