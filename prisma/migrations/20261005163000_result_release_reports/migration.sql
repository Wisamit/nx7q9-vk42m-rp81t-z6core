ALTER TABLE `laboratory_results`
  ADD COLUMN `released_by_user_id` CHAR(36) NULL AFTER `verified_at`,
  ADD COLUMN `amendment_requested_by_user_id` CHAR(36) NULL AFTER `amendment_reason`,
  ADD COLUMN `amendment_requested_at` DATETIME(3) NULL AFTER `amendment_requested_by_user_id`,
  ADD INDEX `laboratory_results_released_by_idx`(`released_by_user_id`),
  ADD INDEX `laboratory_results_amendment_requested_by_idx`(`amendment_requested_by_user_id`),
  ADD CONSTRAINT `laboratory_results_released_by_user_id_fkey` FOREIGN KEY (`released_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `laboratory_results_amendment_requested_by_user_id_fkey` FOREIGN KEY (`amendment_requested_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE `critical_result_events` (
  `id` CHAR(36) NOT NULL,
  `result_id` CHAR(36) NOT NULL,
  `status` ENUM('OPEN','ACKNOWLEDGED','CLOSED') NOT NULL DEFAULT 'OPEN',
  `critical_value_snapshot` JSON NOT NULL,
  `detected_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `acknowledged_at` DATETIME(3) NULL,
  `acknowledged_by_user_id` CHAR(36) NULL,
  `closed_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `critical_result_events_result_id_key`(`result_id`),
  INDEX `critical_result_events_status_detected_idx`(`status`,`detected_at`),
  INDEX `critical_result_events_ack_user_idx`(`acknowledged_by_user_id`),
  CONSTRAINT `critical_result_events_result_id_fkey` FOREIGN KEY (`result_id`) REFERENCES `laboratory_results`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `critical_result_events_acknowledged_by_user_id_fkey` FOREIGN KEY (`acknowledged_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `critical_result_communications` (
  `id` CHAR(36) NOT NULL,
  `critical_event_id` CHAR(36) NOT NULL,
  `method` ENUM('PHONE','VERBAL','EMAIL','SMS','WHATSAPP','OTHER') NOT NULL,
  `outcome` ENUM('ACKNOWLEDGED','NO_ANSWER','LEFT_MESSAGE','FAILED','ESCALATED') NOT NULL,
  `recipient_name` VARCHAR(200) NOT NULL,
  `recipient_role` VARCHAR(150) NULL,
  `recipient_contact` VARCHAR(200) NULL,
  `acknowledgement_confirmed` BOOLEAN NOT NULL DEFAULT false,
  `read_back_confirmed` BOOLEAN NOT NULL DEFAULT false,
  `notes` TEXT NULL,
  `communicated_by_user_id` CHAR(36) NOT NULL,
  `communicated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `critical_communications_event_time_idx`(`critical_event_id`,`communicated_at`),
  INDEX `critical_communications_user_time_idx`(`communicated_by_user_id`,`communicated_at`),
  CONSTRAINT `critical_communications_event_id_fkey` FOREIGN KEY (`critical_event_id`) REFERENCES `critical_result_events`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `critical_communications_user_id_fkey` FOREIGN KEY (`communicated_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `diagnostic_reports` (
  `id` CHAR(36) NOT NULL,
  `organization_id` CHAR(36) NOT NULL,
  `order_id` CHAR(36) NOT NULL,
  `current_version` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `diagnostic_reports_order_id_key`(`order_id`),
  INDEX `diagnostic_reports_org_created_idx`(`organization_id`,`created_at`),
  CONSTRAINT `diagnostic_reports_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `diagnostic_reports_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `diagnostic_report_versions` (
  `id` CHAR(36) NOT NULL,
  `report_id` CHAR(36) NOT NULL,
  `version` INT NOT NULL,
  `status` ENUM('PARTIAL','FINAL','AMENDED','RETRACTED') NOT NULL,
  `branch_id` CHAR(36) NOT NULL,
  `content_snapshot` JSON NOT NULL,
  `result_version_snapshot` JSON NOT NULL,
  `verification_token` VARCHAR(128) NOT NULL,
  `issued_by_user_id` CHAR(36) NOT NULL,
  `issued_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `supersedes_version_id` CHAR(36) NULL,
  `amendment_reason` VARCHAR(1000) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `diagnostic_report_versions_report_version_key`(`report_id`,`version`),
  UNIQUE INDEX `diagnostic_report_versions_verification_token_key`(`verification_token`),
  INDEX `diagnostic_report_versions_branch_issued_idx`(`branch_id`,`issued_at`),
  INDEX `diagnostic_report_versions_status_issued_idx`(`status`,`issued_at`),
  INDEX `diagnostic_report_versions_issuer_idx`(`issued_by_user_id`),
  INDEX `diagnostic_report_versions_supersedes_idx`(`supersedes_version_id`),
  CONSTRAINT `diagnostic_report_versions_report_id_fkey` FOREIGN KEY (`report_id`) REFERENCES `diagnostic_reports`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `diagnostic_report_versions_branch_id_fkey` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `diagnostic_report_versions_issued_by_user_id_fkey` FOREIGN KEY (`issued_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `diagnostic_report_versions_supersedes_version_id_fkey` FOREIGN KEY (`supersedes_version_id`) REFERENCES `diagnostic_report_versions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT IGNORE INTO `permissions` (`id`,`code`,`module`,`description`,`created_at`) VALUES
(UUID(),'results.release','results','Release verified laboratory results',CURRENT_TIMESTAMP(3)),
(UUID(),'results.amend','results','Initiate amendments for released results',CURRENT_TIMESTAMP(3)),
(UUID(),'critical.communicate','results','Document critical result communication and acknowledgement',CURRENT_TIMESTAMP(3)),
(UUID(),'reports.view','reporting','View diagnostic report versions',CURRENT_TIMESTAMP(3));

INSERT IGNORE INTO `role_permissions` (`role_id`,`permission_id`,`granted_at`)
SELECT r.id, p.id, CURRENT_TIMESTAMP(3)
FROM `roles` r
JOIN `permissions` p ON p.code IN ('results.release','results.amend','critical.communicate','reports.view')
WHERE r.code='SYSTEM_ADMIN';
