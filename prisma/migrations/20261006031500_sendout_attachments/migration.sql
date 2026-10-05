CREATE TABLE `external_laboratories` (
  `id` CHAR(36) NOT NULL,
  `organization_id` CHAR(36) NOT NULL,
  `code` VARCHAR(80) NOT NULL,
  `name_en` VARCHAR(220) NOT NULL,
  `name_ar` VARCHAR(220) NULL,
  `phone` VARCHAR(80) NULL,
  `email` VARCHAR(191) NULL,
  `address` TEXT NULL,
  `notes` TEXT NULL,
  `status` ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  `deactivated_at` DATETIME(3) NULL,
  UNIQUE INDEX `external_labs_org_code_uq`(`organization_id`, `code`),
  INDEX `external_labs_org_status_idx`(`organization_id`, `status`),
  PRIMARY KEY (`id`),
  CONSTRAINT `external_labs_org_fk` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `send_out_referrals` (
  `id` CHAR(36) NOT NULL,
  `organization_id` CHAR(36) NOT NULL,
  `branch_id` CHAR(36) NOT NULL,
  `order_item_id` CHAR(36) NOT NULL,
  `specimen_id` CHAR(36) NULL,
  `external_laboratory_id` CHAR(36) NOT NULL,
  `status` ENUM('CREATED','DISPATCHED','RESULT_RECEIVED','VERIFIED','COMPLETED','CANCELLED') NOT NULL DEFAULT 'CREATED',
  `external_accession` VARCHAR(120) NULL,
  `courier` VARCHAR(150) NULL,
  `tracking_reference` VARCHAR(150) NULL,
  `cost_amount` DECIMAL(18,4) NULL,
  `cost_currency` CHAR(3) NULL,
  `expected_result_at` DATETIME(3) NULL,
  `dispatched_by_user_id` CHAR(36) NULL,
  `dispatched_at` DATETIME(3) NULL,
  `received_by_user_id` CHAR(36) NULL,
  `result_received_at` DATETIME(3) NULL,
  `external_result_text` TEXT NULL,
  `verified_by_user_id` CHAR(36) NULL,
  `verified_at` DATETIME(3) NULL,
  `created_by_user_id` CHAR(36) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  INDEX `sendout_org_status_created_idx`(`organization_id`, `status`, `created_at`),
  INDEX `sendout_branch_status_expected_idx`(`branch_id`, `status`, `expected_result_at`),
  INDEX `sendout_order_item_created_idx`(`order_item_id`, `created_at`),
  INDEX `sendout_lab_status_idx`(`external_laboratory_id`, `status`),
  PRIMARY KEY (`id`),
  CONSTRAINT `sendout_org_fk` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `sendout_branch_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `sendout_order_item_fk` FOREIGN KEY (`order_item_id`) REFERENCES `order_items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `sendout_specimen_fk` FOREIGN KEY (`specimen_id`) REFERENCES `specimens`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `sendout_lab_fk` FOREIGN KEY (`external_laboratory_id`) REFERENCES `external_laboratories`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `sendout_created_by_fk` FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `sendout_dispatched_by_fk` FOREIGN KEY (`dispatched_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `sendout_received_by_fk` FOREIGN KEY (`received_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `sendout_verified_by_fk` FOREIGN KEY (`verified_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `send_out_events` (
  `id` CHAR(36) NOT NULL,
  `referral_id` CHAR(36) NOT NULL,
  `from_status` ENUM('CREATED','DISPATCHED','RESULT_RECEIVED','VERIFIED','COMPLETED','CANCELLED') NULL,
  `to_status` ENUM('CREATED','DISPATCHED','RESULT_RECEIVED','VERIFIED','COMPLETED','CANCELLED') NOT NULL,
  `actor_user_id` CHAR(36) NOT NULL,
  `note` VARCHAR(1000) NULL,
  `metadata` JSON NULL,
  `occurred_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `sendout_event_referral_time_idx`(`referral_id`, `occurred_at`),
  PRIMARY KEY (`id`),
  CONSTRAINT `sendout_event_referral_fk` FOREIGN KEY (`referral_id`) REFERENCES `send_out_referrals`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `sendout_event_actor_fk` FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `attachments` (
  `id` CHAR(36) NOT NULL,
  `organization_id` CHAR(36) NOT NULL,
  `branch_id` CHAR(36) NULL,
  `target_type` ENUM('PATIENT','ORDER','RESULT','SEND_OUT_REFERRAL','EQUIPMENT','MAINTENANCE','NONCONFORMANCE','CAPA','QUALITY_DOCUMENT_VERSION') NOT NULL,
  `target_id` CHAR(36) NOT NULL,
  `original_name` VARCHAR(255) NOT NULL,
  `content_type` VARCHAR(120) NOT NULL,
  `size_bytes` INTEGER NOT NULL,
  `sha256` CHAR(64) NOT NULL,
  `uploaded_by_user_id` CHAR(36) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `attachment_target_idx`(`organization_id`, `target_type`, `target_id`, `created_at`),
  INDEX `attachment_branch_created_idx`(`branch_id`, `created_at`),
  PRIMARY KEY (`id`),
  CONSTRAINT `attachment_org_fk` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `attachment_branch_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `attachment_uploader_fk` FOREIGN KEY (`uploaded_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `attachment_contents` (
  `attachment_id` CHAR(36) NOT NULL,
  `data` MEDIUMBLOB NOT NULL,
  PRIMARY KEY (`attachment_id`),
  CONSTRAINT `attachment_content_attachment_fk` FOREIGN KEY (`attachment_id`) REFERENCES `attachments`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT IGNORE INTO `permissions` (`id`,`code`,`module`,`description`,`created_at`) VALUES
(UUID(),'sendouts.view','laboratory','View referral laboratory send-out cases',CURRENT_TIMESTAMP(3)),
(UUID(),'sendouts.manage','laboratory','Create and operate referral laboratory send-out cases',CURRENT_TIMESTAMP(3)),
(UUID(),'sendouts.verify','laboratory','Verify external laboratory results and complete referrals',CURRENT_TIMESTAMP(3)),
(UUID(),'attachments.view','attachments','View secure attachments within authorized records',CURRENT_TIMESTAMP(3)),
(UUID(),'attachments.upload','attachments','Upload secure attachments to authorized records',CURRENT_TIMESTAMP(3));

INSERT IGNORE INTO `role_permissions` (`role_id`,`permission_id`,`granted_at`)
SELECT r.id, p.id, CURRENT_TIMESTAMP(3)
FROM `roles` r
JOIN `permissions` p ON p.code IN ('sendouts.view','sendouts.manage','sendouts.verify','attachments.view','attachments.upload')
WHERE r.code='SYSTEM_ADMIN';
