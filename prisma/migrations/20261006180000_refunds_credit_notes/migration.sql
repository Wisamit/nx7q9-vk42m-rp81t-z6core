-- Phase 4C: immutable credit notes and refund transactions.
ALTER TABLE `invoices`
  ADD COLUMN `credited_amount` DECIMAL(18,4) NOT NULL DEFAULT 0 AFTER `total`;

ALTER TABLE `payments`
  ADD COLUMN `refunded_amount` DECIMAL(18,4) NOT NULL DEFAULT 0 AFTER `amount`;

CREATE TABLE `credit_notes` (
  `id` CHAR(36) NOT NULL,
  `organization_id` CHAR(36) NOT NULL,
  `branch_id` CHAR(36) NOT NULL,
  `invoice_id` CHAR(36) NOT NULL,
  `credit_note_number` VARCHAR(50) NOT NULL,
  `status` ENUM('ISSUED','VOIDED') NOT NULL DEFAULT 'ISSUED',
  `currency` CHAR(3) NOT NULL,
  `amount` DECIMAL(18,4) NOT NULL,
  `reason` VARCHAR(1000) NOT NULL,
  `invoice_total_snapshot` DECIMAL(18,4) NOT NULL,
  `credited_before_snapshot` DECIMAL(18,4) NOT NULL,
  `balance_before_snapshot` DECIMAL(18,4) NOT NULL,
  `credited_after_snapshot` DECIMAL(18,4) NOT NULL,
  `balance_after_snapshot` DECIMAL(18,4) NOT NULL,
  `issued_by_user_id` CHAR(36) NOT NULL,
  `issued_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `credit_notes_org_number_key`(`organization_id`,`credit_note_number`),
  INDEX `credit_notes_branch_issued_idx`(`branch_id`,`issued_at`),
  INDEX `credit_notes_invoice_status_issued_idx`(`invoice_id`,`status`,`issued_at`),
  INDEX `credit_notes_issuer_issued_idx`(`issued_by_user_id`,`issued_at`),
  CONSTRAINT `credit_notes_org_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `credit_notes_branch_fkey` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `credit_notes_invoice_fkey` FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `credit_notes_issuer_fkey` FOREIGN KEY (`issued_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `credit_note_lines` (
  `id` CHAR(36) NOT NULL,
  `credit_note_id` CHAR(36) NOT NULL,
  `invoice_line_id` CHAR(36) NULL,
  `description` VARCHAR(255) NOT NULL,
  `quantity` DECIMAL(12,3) NOT NULL DEFAULT 1,
  `amount` DECIMAL(18,4) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `credit_note_lines_credit_note_idx`(`credit_note_id`),
  INDEX `credit_note_lines_invoice_line_idx`(`invoice_line_id`),
  CONSTRAINT `credit_note_lines_credit_note_fkey` FOREIGN KEY (`credit_note_id`) REFERENCES `credit_notes`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `credit_note_lines_invoice_line_fkey` FOREIGN KEY (`invoice_line_id`) REFERENCES `invoice_lines`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `refunds` (
  `id` CHAR(36) NOT NULL,
  `organization_id` CHAR(36) NOT NULL,
  `branch_id` CHAR(36) NOT NULL,
  `payment_id` CHAR(36) NOT NULL,
  `invoice_id` CHAR(36) NOT NULL,
  `refund_number` VARCHAR(50) NOT NULL,
  `status` ENUM('POSTED','VOIDED') NOT NULL DEFAULT 'POSTED',
  `currency` CHAR(3) NOT NULL,
  `amount` DECIMAL(18,4) NOT NULL,
  `reason` VARCHAR(1000) NOT NULL,
  `reference` VARCHAR(150) NULL,
  `payment_amount_snapshot` DECIMAL(18,4) NOT NULL,
  `allocation_amount_snapshot` DECIMAL(18,4) NOT NULL,
  `refunded_before_snapshot` DECIMAL(18,4) NOT NULL,
  `invoice_paid_before_snapshot` DECIMAL(18,4) NOT NULL,
  `invoice_balance_before_snapshot` DECIMAL(18,4) NOT NULL,
  `invoice_paid_after_snapshot` DECIMAL(18,4) NOT NULL,
  `invoice_balance_after_snapshot` DECIMAL(18,4) NOT NULL,
  `processed_by_user_id` CHAR(36) NOT NULL,
  `processed_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `refunds_org_number_key`(`organization_id`,`refund_number`),
  INDEX `refunds_branch_processed_idx`(`branch_id`,`processed_at`),
  INDEX `refunds_invoice_status_processed_idx`(`invoice_id`,`status`,`processed_at`),
  INDEX `refunds_payment_status_processed_idx`(`payment_id`,`status`,`processed_at`),
  INDEX `refunds_processor_processed_idx`(`processed_by_user_id`,`processed_at`),
  CONSTRAINT `refunds_org_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `refunds_branch_fkey` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `refunds_payment_fkey` FOREIGN KEY (`payment_id`) REFERENCES `payments`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `refunds_invoice_fkey` FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `refunds_processor_fkey` FOREIGN KEY (`processed_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
