-- Stage 3 / Part 7: governed qualitative result semantics and critical textual rules.
ALTER TABLE `qualitative_result_options`
  ADD COLUMN `approval_status` ENUM('DRAFT','APPROVED','RETIRED') NOT NULL DEFAULT 'DRAFT' AFTER `effective_to`,
  ADD COLUMN `approved_by_user_id` CHAR(36) NULL AFTER `created_by_user_id`,
  ADD COLUMN `approved_at` DATETIME(3) NULL AFTER `approved_by_user_id`,
  ADD COLUMN `retired_by_user_id` CHAR(36) NULL AFTER `approved_at`,
  ADD COLUMN `retired_at` DATETIME(3) NULL AFTER `retired_by_user_id`,
  ADD COLUMN `retirement_reason` VARCHAR(1000) NULL AFTER `retired_at`;

UPDATE `qualitative_result_options`
SET `approval_status` = 'DRAFT',
    `status` = 'INACTIVE',
    `deactivated_at` = COALESCE(`deactivated_at`, CURRENT_TIMESTAMP(3));

ALTER TABLE `qualitative_result_options`
  MODIFY `status` ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'INACTIVE',
  ADD INDEX `qual_result_options_approval_idx` (`organization_id`, `approval_status`, `status`),
  ADD CONSTRAINT `qual_result_options_approved_by_user_id_fkey`
    FOREIGN KEY (`approved_by_user_id`) REFERENCES `users`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `qual_result_options_retired_by_user_id_fkey`
    FOREIGN KEY (`retired_by_user_id`) REFERENCES `users`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT IGNORE INTO `permissions` (`id`,`code`,`module`,`description`,`created_at`) VALUES
(UUID(),'clinical_rules.qualitative_options.approve','clinical_rules','Approve and retire qualitative result semantics and critical textual rules',CURRENT_TIMESTAMP(3));

INSERT IGNORE INTO `role_permissions` (`role_id`,`permission_id`,`granted_at`)
SELECT rp.role_id, p_new.id, CURRENT_TIMESTAMP(3)
FROM `role_permissions` rp
JOIN `permissions` p_old ON p_old.id = rp.permission_id AND p_old.code = 'clinical_rules.manage'
JOIN `permissions` p_new ON p_new.code = 'clinical_rules.qualitative_options.approve';

INSERT IGNORE INTO `role_permissions` (`role_id`,`permission_id`,`granted_at`)
SELECT r.id, p.id, CURRENT_TIMESTAMP(3)
FROM `roles` r
JOIN `permissions` p ON p.code = 'clinical_rules.qualitative_options.approve'
WHERE r.code = 'SYSTEM_ADMIN';
