-- Stage 3 / Part 10: governed analyzer-to-LIS mappings and unit-safety snapshots.
-- Legacy mappings have no explicit clinical approval or target-unit attestation, so they fail closed.
ALTER TABLE `analyzer_test_mappings`
  ADD COLUMN `approval_status` ENUM('DRAFT','APPROVED','RETIRED') NOT NULL DEFAULT 'DRAFT' AFTER `effective_to`,
  ADD COLUMN `lis_unit_id_snapshot` CHAR(36) NULL AFTER `approval_status`,
  ADD COLUMN `lis_unit_code_snapshot` VARCHAR(50) NULL AFTER `lis_unit_id_snapshot`,
  ADD COLUMN `lis_unit_symbol_snapshot` VARCHAR(50) NULL AFTER `lis_unit_code_snapshot`,
  ADD COLUMN `lis_unit_ucum_code_snapshot` VARCHAR(50) NULL AFTER `lis_unit_symbol_snapshot`,
  ADD COLUMN `created_by_user_id` CHAR(36) NULL AFTER `lis_unit_ucum_code_snapshot`,
  ADD COLUMN `approved_by_user_id` CHAR(36) NULL AFTER `created_by_user_id`,
  ADD COLUMN `approved_at` DATETIME(3) NULL AFTER `approved_by_user_id`,
  ADD COLUMN `retired_by_user_id` CHAR(36) NULL AFTER `approved_at`,
  ADD COLUMN `retired_at` DATETIME(3) NULL AFTER `retired_by_user_id`,
  ADD COLUMN `retirement_reason` VARCHAR(1000) NULL AFTER `retired_at`;

UPDATE `analyzer_test_mappings`
SET `approval_status`='DRAFT', `status`='INACTIVE',
    `deactivated_at`=COALESCE(`deactivated_at`,CURRENT_TIMESTAMP(3));

ALTER TABLE `analyzer_test_mappings`
  MODIFY `status` ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'INACTIVE',
  ADD INDEX `analyzer_mapping_approval_effective_idx` (`analyzer_id`,`approval_status`,`status`,`effective_from`,`effective_to`),
  ADD INDEX `analyzer_mapping_creator_idx` (`created_by_user_id`,`created_at`),
  ADD INDEX `analyzer_mapping_approver_idx` (`approved_by_user_id`,`approved_at`),
  ADD CONSTRAINT `analyzer_mapping_created_by_fk` FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `analyzer_mapping_approved_by_fk` FOREIGN KEY (`approved_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `analyzer_mapping_retired_by_fk` FOREIGN KEY (`retired_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT IGNORE INTO `permissions` (`id`,`code`,`module`,`description`,`created_at`) VALUES
(UUID(),'analyzers.mappings.approve','integrations','Approve and retire analyzer-to-LIS mappings used for clinical import',CURRENT_TIMESTAMP(3));

INSERT IGNORE INTO `role_permissions` (`role_id`,`permission_id`,`granted_at`)
SELECT rp.role_id,p_new.id,CURRENT_TIMESTAMP(3)
FROM `role_permissions` rp
JOIN `permissions` p_old ON p_old.id=rp.permission_id AND p_old.code='analyzers.manage'
JOIN `permissions` p_new ON p_new.code='analyzers.mappings.approve';

INSERT IGNORE INTO `role_permissions` (`role_id`,`permission_id`,`granted_at`)
SELECT r.id,p.id,CURRENT_TIMESTAMP(3)
FROM `roles` r JOIN `permissions` p ON p.code='analyzers.mappings.approve'
WHERE r.code='SYSTEM_ADMIN';

INSERT INTO `audit_events`
(`id`,`organization_id`,`branch_id`,`action`,`entity_type`,`entity_id`,`new_values`,`reason`)
SELECT UUID(),a.`organization_id`,a.`branch_id`,'ANALYZER_MAPPING_LEGACY_REVIEW_REQUIRED',
       'AnalyzerTestMapping',m.`id`,
       JSON_OBJECT('approvalStatus','DRAFT','status','INACTIVE','analyzerTestCode',m.`analyzer_test_code`),
       'Legacy analyzer mapping requires explicit clinical approval and LIS target-unit attestation after Stage 3 Part 10'
FROM `analyzer_test_mappings` m JOIN `analyzers` a ON a.`id`=m.`analyzer_id`;
