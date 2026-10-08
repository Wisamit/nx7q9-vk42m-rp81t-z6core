-- Stage 3 / Part 6: governed reference interval approval lifecycle.
ALTER TABLE `reference_intervals`
  ADD COLUMN `approval_status` ENUM('DRAFT','APPROVED','RETIRED') NOT NULL DEFAULT 'DRAFT' AFTER `effective_to`,
  ADD COLUMN `created_by_user_id` CHAR(36) NULL AFTER `approval_status`,
  ADD COLUMN `retired_by_user_id` CHAR(36) NULL AFTER `approved_at`,
  ADD COLUMN `retired_at` DATETIME(3) NULL AFTER `retired_by_user_id`,
  ADD COLUMN `retirement_reason` VARCHAR(1000) NULL AFTER `retired_at`;

UPDATE `reference_intervals`
SET `approval_status` = CASE
  WHEN `approved_at` IS NOT NULL AND `status` = 'ACTIVE' THEN 'APPROVED'
  WHEN `approved_at` IS NOT NULL AND `status` = 'INACTIVE' THEN 'RETIRED'
  ELSE 'DRAFT'
END;

UPDATE `reference_intervals`
SET `status` = 'INACTIVE'
WHERE `approval_status` = 'DRAFT';

ALTER TABLE `reference_intervals`
  MODIFY `status` ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'INACTIVE',
  ADD INDEX `reference_intervals_governance_idx` (`component_id`, `approval_status`, `status`, `effective_from`, `effective_to`),
  ADD CONSTRAINT `reference_intervals_created_by_user_id_fkey`
    FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `reference_intervals_retired_by_user_id_fkey`
    FOREIGN KEY (`retired_by_user_id`) REFERENCES `users`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT IGNORE INTO `permissions` (`id`,`code`,`module`,`description`,`created_at`) VALUES
(UUID(),'catalog.reference_ranges.approve','catalog','Approve and retire clinical reference intervals and critical limits',CURRENT_TIMESTAMP(3));

INSERT IGNORE INTO `role_permissions` (`role_id`,`permission_id`,`granted_at`)
SELECT rp.role_id, p_new.id, CURRENT_TIMESTAMP(3)
FROM `role_permissions` rp
JOIN `permissions` p_old ON p_old.id = rp.permission_id AND p_old.code = 'catalog.reference_ranges.manage'
JOIN `permissions` p_new ON p_new.code = 'catalog.reference_ranges.approve';

INSERT IGNORE INTO `role_permissions` (`role_id`,`permission_id`,`granted_at`)
SELECT r.id, p.id, CURRENT_TIMESTAMP(3)
FROM `roles` r
JOIN `permissions` p ON p.code = 'catalog.reference_ranges.approve'
WHERE r.code = 'SYSTEM_ADMIN';
