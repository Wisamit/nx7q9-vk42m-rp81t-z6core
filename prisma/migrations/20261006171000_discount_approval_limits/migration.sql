-- Phase 4B: discount limits, approval evidence and re-auth permission.
ALTER TABLE `roles`
  ADD COLUMN `discount_limit_percent` DECIMAL(5,2) NOT NULL DEFAULT 0 AFTER `is_system`;

ALTER TABLE `users`
  ADD COLUMN `discount_limit_percent` DECIMAL(5,2) NULL AFTER `mfa_recovery_codes`;

ALTER TABLE `invoices`
  ADD COLUMN `discount_percent` DECIMAL(5,2) NOT NULL DEFAULT 0 AFTER `discount_total`,
  ADD COLUMN `discount_reason` VARCHAR(1000) NULL AFTER `discount_percent`,
  ADD COLUMN `discount_approval_method` ENUM('SELF_LIMIT','APPROVER_REAUTH') NULL AFTER `discount_reason`,
  ADD COLUMN `discount_approved_by_user_id` CHAR(36) NULL AFTER `discount_approval_method`,
  ADD COLUMN `discount_approved_at` DATETIME(3) NULL AFTER `discount_approved_by_user_id`,
  ADD INDEX `invoices_discount_approver_time_idx`(`discount_approved_by_user_id`, `discount_approved_at`),
  ADD CONSTRAINT `invoices_discount_approved_by_fkey`
    FOREIGN KEY (`discount_approved_by_user_id`) REFERENCES `users`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT IGNORE INTO `permissions` (`id`,`code`,`module`,`description`,`created_at`) VALUES
(UUID(),'billing.discount.approve','billing','Approve order discounts above the requester limit',CURRENT_TIMESTAMP(3));

INSERT IGNORE INTO `role_permissions` (`role_id`,`permission_id`,`granted_at`)
SELECT r.id,p.id,CURRENT_TIMESTAMP(3)
FROM `roles` r
JOIN `permissions` p ON p.code='billing.discount.approve'
WHERE r.code='SYSTEM_ADMIN';

UPDATE `roles`
SET `discount_limit_percent` = 100.00
WHERE `code`='SYSTEM_ADMIN';
