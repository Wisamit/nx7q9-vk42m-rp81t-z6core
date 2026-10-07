-- Phase 4D: cashier shifts, controlled closing and approval.

CREATE TABLE `cashier_shifts` (
  `id` CHAR(36) NOT NULL,
  `organization_id` CHAR(36) NOT NULL,
  `branch_id` CHAR(36) NOT NULL,
  `cashier_user_id` CHAR(36) NOT NULL,
  `shift_number` VARCHAR(50) NOT NULL,
  `currency` CHAR(3) NOT NULL,
  `opening_cash` DECIMAL(18,4) NOT NULL,
  `status` ENUM('OPEN','PENDING_APPROVAL','CLOSED') NOT NULL DEFAULT 'OPEN',
  `active_key` VARCHAR(160) NULL,
  `activity_version` INT NOT NULL DEFAULT 0,
  `opened_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `closed_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `cashier_shifts_active_key_key`(`active_key`),
  UNIQUE INDEX `cashier_shifts_org_number_key`(`organization_id`,`shift_number`),
  INDEX `cashier_shifts_branch_status_opened_idx`(`branch_id`,`status`,`opened_at`),
  INDEX `cashier_shifts_cashier_status_opened_idx`(`cashier_user_id`,`status`,`opened_at`),
  INDEX `cashier_shifts_org_currency_status_idx`(`organization_id`,`currency`,`status`),
  CONSTRAINT `cashier_shifts_org_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `cashier_shifts_branch_fkey` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `cashier_shifts_cashier_fkey` FOREIGN KEY (`cashier_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `cashier_shift_closures` (
  `id` CHAR(36) NOT NULL,
  `cashier_shift_id` CHAR(36) NOT NULL,
  `attempt_number` INT NOT NULL,
  `status` ENUM('PENDING','APPROVED','REJECTED') NOT NULL DEFAULT 'PENDING',
  `activity_version_snapshot` INT NOT NULL,
  `opening_cash_snapshot` DECIMAL(18,4) NOT NULL,
  `cash_receipts_snapshot` DECIMAL(18,4) NOT NULL,
  `cash_refunds_snapshot` DECIMAL(18,4) NOT NULL,
  `expected_cash_snapshot` DECIMAL(18,4) NOT NULL,
  `actual_cash` DECIMAL(18,4) NOT NULL,
  `difference_amount` DECIMAL(18,4) NOT NULL,
  `payment_count_snapshot` INT NOT NULL,
  `cash_payment_count_snapshot` INT NOT NULL,
  `refund_count_snapshot` INT NOT NULL,
  `cash_refund_count_snapshot` INT NOT NULL,
  `notes` VARCHAR(1000) NULL,
  `submitted_by_user_id` CHAR(36) NOT NULL,
  `submitted_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `reviewed_by_user_id` CHAR(36) NULL,
  `reviewed_at` DATETIME(3) NULL,
  `review_note` VARCHAR(1000) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `cashier_shift_closures_shift_attempt_key`(`cashier_shift_id`,`attempt_number`),
  INDEX `cashier_shift_closures_status_submitted_idx`(`status`,`submitted_at`),
  INDEX `cashier_shift_closures_reviewer_reviewed_idx`(`reviewed_by_user_id`,`reviewed_at`),
  CONSTRAINT `cashier_shift_closures_shift_fkey` FOREIGN KEY (`cashier_shift_id`) REFERENCES `cashier_shifts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `cashier_shift_closures_submitter_fkey` FOREIGN KEY (`submitted_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `cashier_shift_closures_reviewer_fkey` FOREIGN KEY (`reviewed_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `payments`
  ADD COLUMN `cashier_shift_id` CHAR(36) NULL AFTER `cashier_user_id`,
  ADD INDEX `payments_cashier_shift_received_idx`(`cashier_shift_id`,`received_at`),
  ADD CONSTRAINT `payments_cashier_shift_fkey`
    FOREIGN KEY (`cashier_shift_id`) REFERENCES `cashier_shifts`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `refunds`
  ADD COLUMN `method` ENUM('CASH','CARD','BANK_TRANSFER','ONLINE','CREDIT_ACCOUNT','OTHER') NULL AFTER `amount`,
  ADD COLUMN `cashier_shift_id` CHAR(36) NULL AFTER `processed_by_user_id`,
  ADD INDEX `refunds_cashier_shift_processed_idx`(`cashier_shift_id`,`processed_at`);

UPDATE `refunds` r
JOIN `payments` p ON p.`id` = r.`payment_id`
SET r.`method` = p.`method`
WHERE r.`method` IS NULL;

ALTER TABLE `refunds`
  MODIFY COLUMN `method` ENUM('CASH','CARD','BANK_TRANSFER','ONLINE','CREDIT_ACCOUNT','OTHER') NOT NULL,
  ADD CONSTRAINT `refunds_cashier_shift_fkey`
    FOREIGN KEY (`cashier_shift_id`) REFERENCES `cashier_shifts`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT IGNORE INTO `permissions` (`id`,`code`,`module`,`description`,`created_at`) VALUES
(UUID(),'billing.cashier.approve','billing','Approve or reject cashier shift closings',CURRENT_TIMESTAMP(3)),
(UUID(),'billing.cashier.authority.manage','billing','Manage cashier closing approval authority',CURRENT_TIMESTAMP(3));

INSERT IGNORE INTO `role_permissions` (`role_id`,`permission_id`,`granted_at`)
SELECT r.id,p.id,CURRENT_TIMESTAMP(3)
FROM `roles` r
JOIN `permissions` p ON p.code IN ('billing.cashier.approve','billing.cashier.authority.manage')
WHERE r.code='SYSTEM_ADMIN';
