CREATE TABLE `result_validation_policies` (
  `id` CHAR(36) NOT NULL,
  `organization_id` CHAR(36) NOT NULL,
  `scope` ENUM('ORGANIZATION','DEPARTMENT','TEST') NOT NULL,
  `department_id` CHAR(36) NULL,
  `test_id` CHAR(36) NULL,
  `code` VARCHAR(80) NOT NULL,
  `name_en` VARCHAR(200) NOT NULL,
  `name_ar` VARCHAR(200) NULL,
  `requires_medical_validation` BOOLEAN NOT NULL DEFAULT false,
  `allow_same_reviewer` BOOLEAN NOT NULL DEFAULT false,
  `effective_from` DATETIME(3) NOT NULL,
  `effective_to` DATETIME(3) NULL,
  `status` ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  `created_by_user_id` CHAR(36) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  `deactivated_at` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `result_validation_policies_org_code_key`(`organization_id`, `code`),
  INDEX `result_validation_policy_scope_idx`(`organization_id`, `scope`, `status`, `effective_from`, `effective_to`),
  INDEX `result_validation_policy_department_idx`(`department_id`, `status`, `effective_from`),
  INDEX `result_validation_policy_test_idx`(`test_id`, `status`, `effective_from`),
  CONSTRAINT `result_validation_policy_org_fk` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `result_validation_policy_department_fk` FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `result_validation_policy_test_fk` FOREIGN KEY (`test_id`) REFERENCES `lab_tests`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `result_validation_policy_creator_fk` FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `laboratory_results`
  ADD COLUMN `validation_stage` ENUM('ENTRY','TECHNICAL_REVIEW','MEDICAL_VALIDATION','COMPLETE') NOT NULL DEFAULT 'ENTRY' AFTER `verified_at`,
  ADD COLUMN `validation_policy_id` CHAR(36) NULL AFTER `validation_stage`,
  ADD COLUMN `validation_policy_snapshot` JSON NULL AFTER `validation_policy_id`,
  ADD COLUMN `technical_reviewed_by_user_id` CHAR(36) NULL AFTER `validation_policy_snapshot`,
  ADD COLUMN `technical_reviewed_at` DATETIME(3) NULL AFTER `technical_reviewed_by_user_id`,
  ADD COLUMN `medically_validated_by_user_id` CHAR(36) NULL AFTER `technical_reviewed_at`,
  ADD COLUMN `medically_validated_at` DATETIME(3) NULL AFTER `medically_validated_by_user_id`,
  ADD INDEX `laboratory_results_validation_policy_idx`(`validation_policy_id`),
  ADD INDEX `laboratory_results_validation_stage_status_idx`(`validation_stage`, `status`),
  ADD INDEX `laboratory_results_technical_reviewer_idx`(`technical_reviewed_by_user_id`, `technical_reviewed_at`),
  ADD INDEX `laboratory_results_medical_validator_idx`(`medically_validated_by_user_id`, `medically_validated_at`),
  ADD CONSTRAINT `laboratory_results_validation_policy_fk` FOREIGN KEY (`validation_policy_id`) REFERENCES `result_validation_policies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `laboratory_results_technical_reviewer_fk` FOREIGN KEY (`technical_reviewed_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `laboratory_results_medical_validator_fk` FOREIGN KEY (`medically_validated_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

UPDATE `laboratory_results`
SET
  `validation_stage` = 'COMPLETE',
  `validation_policy_snapshot` = JSON_OBJECT(
    'source', 'MIGRATED_BASELINE',
    'path', 'LEGACY_VERIFICATION',
    'policyKnown', false
  )
WHERE `status` IN ('VERIFIED','RELEASED','AMENDED');

CREATE TABLE `result_validation_reviews` (
  `id` CHAR(36) NOT NULL,
  `result_id` CHAR(36) NOT NULL,
  `stage` ENUM('TECHNICAL_REVIEW','MEDICAL_VALIDATION') NOT NULL,
  `outcome` ENUM('APPROVED','RETURNED') NOT NULL DEFAULT 'APPROVED',
  `reviewer_user_id` CHAR(36) NULL,
  `reviewed_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `automated` BOOLEAN NOT NULL DEFAULT false,
  `notes` VARCHAR(1000) NULL,
  `policy_snapshot` JSON NULL,
  PRIMARY KEY (`id`),
  INDEX `result_validation_reviews_result_stage_idx`(`result_id`, `stage`, `reviewed_at`),
  INDEX `result_validation_reviews_reviewer_idx`(`reviewer_user_id`, `reviewed_at`),
  CONSTRAINT `result_validation_reviews_result_fk` FOREIGN KEY (`result_id`) REFERENCES `laboratory_results`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `result_validation_reviews_reviewer_fk` FOREIGN KEY (`reviewer_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT IGNORE INTO `permissions` (`id`,`code`,`module`,`description`,`created_at`) VALUES
(UUID(),'results.technical_review','results','Perform technical review of laboratory results',CURRENT_TIMESTAMP(3)),
(UUID(),'results.medical_validate','results','Perform medical validation of laboratory results',CURRENT_TIMESTAMP(3));

INSERT IGNORE INTO `role_permissions` (`role_id`,`permission_id`,`granted_at`)
SELECT rp.role_id, p_new.id, CURRENT_TIMESTAMP(3)
FROM `role_permissions` rp
JOIN `permissions` p_old ON p_old.id = rp.permission_id AND p_old.code = 'results.verify'
JOIN `permissions` p_new ON p_new.code = 'results.technical_review';

INSERT IGNORE INTO `role_permissions` (`role_id`,`permission_id`,`granted_at`)
SELECT r.id, p.id, CURRENT_TIMESTAMP(3)
FROM `roles` r
JOIN `permissions` p ON p.code = 'results.medical_validate'
WHERE r.code = 'SYSTEM_ADMIN';
