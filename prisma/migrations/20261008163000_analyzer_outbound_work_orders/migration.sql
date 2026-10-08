-- Outbound analyzer work order is intentionally protocol-neutral; an authenticated
-- Analyzer Bridge performs instrument-specific ASTM / HL7 framing and transport.
-- No historical result or patient-identifying name is stored in this outbox.
CREATE TABLE `analyzer_work_orders` (
  `id` CHAR(36) NOT NULL,
  `organization_id` CHAR(36) NOT NULL,
  `branch_id` CHAR(36) NOT NULL,
  `analyzer_id` CHAR(36) NOT NULL,
  `order_item_id` CHAR(36) NOT NULL,
  `specimen_id` CHAR(36) NOT NULL,
  `assignment_event_id` CHAR(36) NOT NULL,
  `accession_number_snapshot` VARCHAR(80) NOT NULL,
  `barcode_snapshot` VARCHAR(80) NOT NULL,
  `test_code_snapshot` VARCHAR(80) NOT NULL,
  `analyzer_test_code_snapshot` VARCHAR(120) NOT NULL,
  `bridge_device_key_snapshot` VARCHAR(150) NOT NULL,
  `status` ENUM('QUEUED','CLAIMED','ACKNOWLEDGED','RETRY_WAIT','DEAD_LETTER','CANCELLED') NOT NULL DEFAULT 'QUEUED',
  `attempt_count` INTEGER NOT NULL DEFAULT 0,
  `max_attempts` INTEGER NOT NULL DEFAULT 5,
  `claim_token_hash` CHAR(64) NULL,
  `claimed_at` DATETIME(3) NULL,
  `lease_expires_at` DATETIME(3) NULL,
  `next_attempt_at` DATETIME(3) NULL,
  `acknowledged_at` DATETIME(3) NULL,
  `acknowledgement` TEXT NULL,
  `last_error` TEXT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `analyzer_work_orders_assignment_event_id_key`(`assignment_event_id`),
  INDEX `analyzer_work_orders_analyzer_id_status_next_attempt_at_idx`(`analyzer_id`,`status`,`next_attempt_at`),
  INDEX `analyzer_work_orders_organization_id_status_created_at_idx`(`organization_id`,`status`,`created_at`),
  INDEX `analyzer_work_orders_order_item_id_status_idx`(`order_item_id`,`status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `analyzer_work_orders`
  ADD CONSTRAINT `analyzer_work_orders_organization_id_fkey`
    FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `analyzer_work_orders_branch_id_fkey`
    FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `analyzer_work_orders_analyzer_id_fkey`
    FOREIGN KEY (`analyzer_id`) REFERENCES `analyzers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `analyzer_work_orders_order_item_id_fkey`
    FOREIGN KEY (`order_item_id`) REFERENCES `order_items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `analyzer_work_orders_specimen_id_fkey`
    FOREIGN KEY (`specimen_id`) REFERENCES `specimens`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
