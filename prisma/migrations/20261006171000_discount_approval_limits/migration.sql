-- Phase 4B: discount limits and audited approval workflow.
ALTER TABLE `roles`
  ADD COLUMN `discount_limit_percent` DECIMAL(5,2) NOT NULL DEFAULT 0 AFTER `is_system`;

ALTER TABLE `users`
  ADD COLUMN `discount_limit_percent` DECIMAL(5,2) NULL AFTER `mfa_recovery_codes`;

ALTER TABLE `invoices`
  ADD COLUMN `discount_percent` DECIMAL(5,2) NOT NULL DEFAULT 0 AFTER `discount_total`,
  ADD COLUMN `discount_reason` VARCHAR(1000) NULL AFTER `discount_percent`,
  ADD COLUMN `discount_approval_method` ENUM('SELF_LIMIT','APPROVAL_WORKFLOW') NULL AFTER `discount_reason`,
  ADD COLUMN `discount_approved_by_user_id` CHAR(36) NULL AFTER `discount_approval_method`,
  ADD COLUMN `discount_approved_at` DATETIME(3) NULL AFTER `discount_approved_by_user_id`,
  ADD INDEX `invoices_discount_approver_time_idx`(`discount_approved_by_user_id`, `discount_approved_at`),
  ADD CONSTRAINT `invoices_discount_approved_by_fkey`
    FOREIGN KEY (`discount_approved_by_user_id`) REFERENCES `users`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;


CREATE TABLE `discount_approval_requests` (
  `id` CHAR(36) NOT NULL,
  `organization_id` CHAR(36) NOT NULL,
  `branch_id` CHAR(36) NOT NULL,
  `requested_by_user_id` CHAR(36) NOT NULL,
  `approved_by_user_id` CHAR(36) NULL,
  `status` ENUM('PENDING','APPROVED','REJECTED','USED','EXPIRED') NOT NULL DEFAULT 'PENDING',
  `discount_percent` DECIMAL(5,2) NOT NULL,
  `reason` VARCHAR(1000) NOT NULL,
  `currency` CHAR(3) NOT NULL,
  `subtotal_snapshot` DECIMAL(18,4) NOT NULL,
  `discount_total_snapshot` DECIMAL(18,4) NOT NULL,
  `final_total_snapshot` DECIMAL(18,4) NOT NULL,
  `pricing_fingerprint` CHAR(64) NOT NULL,
  `context_snapshot` JSON NOT NULL,
  `approval_note` VARCHAR(1000) NULL,
  `requested_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `expires_at` DATETIME(3) NOT NULL,
  `approved_at` DATETIME(3) NULL,
  `rejected_at` DATETIME(3) NULL,
  `used_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `discount_approval_org_status_requested_idx`(`organization_id`,`status`,`requested_at`),
  INDEX `discount_approval_branch_status_expiry_idx`(`branch_id`,`status`,`expires_at`),
  INDEX `discount_approval_requester_status_expiry_idx`(`requested_by_user_id`,`status`,`expires_at`),
  INDEX `discount_approval_approver_time_idx`(`approved_by_user_id`,`approved_at`),
  INDEX `discount_approval_fingerprint_status_expiry_idx`(`pricing_fingerprint`,`status`,`expires_at`),
  CONSTRAINT `discount_approval_org_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `discount_approval_branch_fkey` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `discount_approval_requester_fkey` FOREIGN KEY (`requested_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `discount_approval_approver_fkey` FOREIGN KEY (`approved_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `invoices`
  ADD COLUMN `discount_approval_request_id` CHAR(36) NULL AFTER `discount_approved_at`,
  ADD UNIQUE INDEX `invoices_discount_approval_request_key`(`discount_approval_request_id`),
  ADD CONSTRAINT `invoices_discount_approval_request_fkey`
    FOREIGN KEY (`discount_approval_request_id`) REFERENCES `discount_approval_requests`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT IGNORE INTO `permissions` (`id`,`code`,`module`,`description`,`created_at`) VALUES
(UUID(),'billing.discount.approve','billing','Approve order discounts above the requester limit',CURRENT_TIMESTAMP(3)),
(UUID(),'billing.discount.limits.manage','billing','Configure role and user discount limits',CURRENT_TIMESTAMP(3));

INSERT IGNORE INTO `role_permissions` (`role_id`,`permission_id`,`granted_at`)
SELECT r.id,p.id,CURRENT_TIMESTAMP(3)
FROM `roles` r
JOIN `permissions` p ON p.code IN ('billing.discount.approve','billing.discount.limits.manage')
WHERE r.code='SYSTEM_ADMIN';

UPDATE `roles`
SET `discount_limit_percent` = 100.00
WHERE `code`='SYSTEM_ADMIN';
