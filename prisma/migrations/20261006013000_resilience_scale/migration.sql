CREATE TABLE `retention_policies` (
  `id` CHAR(36) NOT NULL,
  `organization_id` CHAR(36) NOT NULL,
  `data_class` ENUM('ANALYZER_MESSAGES','INTEGRATION_MESSAGES','WEBHOOK_DELIVERIES','PORTAL_SESSIONS','USER_SESSIONS','AUDIT_EVENTS','CLINICAL_RESULTS','DIAGNOSTIC_REPORTS') NOT NULL,
  `action` ENUM('ARCHIVE','PURGE','RETAIN_ONLY') NOT NULL DEFAULT 'RETAIN_ONLY',
  `retain_days` INTEGER NULL,
  `archive_after_days` INTEGER NULL,
  `enabled` BOOLEAN NOT NULL DEFAULT false,
  `notes` VARCHAR(1000) NULL,
  `created_by_user_id` CHAR(36) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `retention_policies_org_data_class_key`(`organization_id`,`data_class`),
  INDEX `retention_policies_org_enabled_idx`(`organization_id`,`enabled`),
  CONSTRAINT `retention_policies_org_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `retention_policies_creator_fkey` FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `backup_verifications` (
  `id` CHAR(36) NOT NULL,
  `organization_id` CHAR(36) NOT NULL,
  `branch_id` CHAR(36) NULL,
  `provider` VARCHAR(160) NOT NULL,
  `backup_reference` VARCHAR(500) NOT NULL,
  `backup_created_at` DATETIME(3) NOT NULL,
  `status` ENUM('RECORDED','VERIFIED','FAILED') NOT NULL DEFAULT 'RECORDED',
  `restore_tested_at` DATETIME(3) NULL,
  `restore_duration_minutes` INTEGER NULL,
  `evidence_reference` VARCHAR(1000) NULL,
  `notes` TEXT NULL,
  `recorded_by_user_id` CHAR(36) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `backup_verifications_org_created_idx`(`organization_id`,`backup_created_at`),
  INDEX `backup_verifications_branch_created_idx`(`branch_id`,`backup_created_at`),
  INDEX `backup_verifications_status_restore_idx`(`status`,`restore_tested_at`),
  CONSTRAINT `backup_verifications_org_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `backup_verifications_branch_fkey` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `backup_verifications_recorder_fkey` FOREIGN KEY (`recorded_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `disaster_recovery_drills` (
  `id` CHAR(36) NOT NULL,
  `organization_id` CHAR(36) NOT NULL,
  `branch_id` CHAR(36) NULL,
  `title` VARCHAR(255) NOT NULL,
  `status` ENUM('PLANNED','IN_PROGRESS','PASSED','FAILED','CANCELLED') NOT NULL DEFAULT 'PLANNED',
  `target_rpo_minutes` INTEGER NOT NULL,
  `target_rto_minutes` INTEGER NOT NULL,
  `actual_rpo_minutes` INTEGER NULL,
  `actual_rto_minutes` INTEGER NULL,
  `scheduled_at` DATETIME(3) NOT NULL,
  `started_at` DATETIME(3) NULL,
  `completed_at` DATETIME(3) NULL,
  `owner_user_id` CHAR(36) NOT NULL,
  `recorded_by_user_id` CHAR(36) NOT NULL,
  `evidence_reference` VARCHAR(1000) NULL,
  `findings` TEXT NULL,
  `corrective_actions` TEXT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `dr_drills_org_status_scheduled_idx`(`organization_id`,`status`,`scheduled_at`),
  INDEX `dr_drills_branch_status_scheduled_idx`(`branch_id`,`status`,`scheduled_at`),
  CONSTRAINT `dr_drills_org_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `dr_drills_branch_fkey` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `dr_drills_owner_fkey` FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `dr_drills_recorder_fkey` FOREIGN KEY (`recorded_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `branch_continuity_policies` (
  `id` CHAR(36) NOT NULL,
  `branch_id` CHAR(36) NOT NULL,
  `mode` ENUM('CENTRAL_ONLY','READ_ONLY_CACHE','BUFFER_NON_CLINICAL') NOT NULL DEFAULT 'CENTRAL_ONLY',
  `offline_clinical_writes_allowed` BOOLEAN NOT NULL DEFAULT false,
  `local_buffer_minutes` INTEGER NULL,
  `notes` VARCHAR(1000) NULL,
  `updated_by_user_id` CHAR(36) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `branch_continuity_policies_branch_key`(`branch_id`),
  INDEX `branch_continuity_policies_mode_idx`(`mode`),
  CONSTRAINT `branch_continuity_policies_branch_fkey` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `branch_continuity_policies_updater_fkey` FOREIGN KEY (`updated_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE INDEX `orders_branch_status_ordered_idx` ON `orders`(`ordering_branch_id`,`status`,`ordered_at`);
CREATE INDEX `specimens_branch_status_updated_idx` ON `specimens`(`current_branch_id`,`status`,`updated_at`);
CREATE INDEX `user_sessions_expiry_revoked_idx` ON `user_sessions`(`expires_at`,`revoked_at`);
CREATE INDEX `analyzer_messages_status_received_idx` ON `analyzer_messages`(`status`,`received_at`);
CREATE INDEX `audit_events_occurred_idx` ON `audit_events`(`occurred_at`);

INSERT IGNORE INTO `permissions` (`id`,`code`,`module`,`description`,`created_at`) VALUES
(UUID(),'resilience.view','operations','View resilience, backup, retention and recovery status',CURRENT_TIMESTAMP(3)),
(UUID(),'resilience.manage','operations','Manage resilience policies, backup verification and disaster recovery drills',CURRENT_TIMESTAMP(3)),
(UUID(),'resilience.archive','operations','Execute approved technical-log archive and purge operations',CURRENT_TIMESTAMP(3));

INSERT IGNORE INTO `role_permissions` (`role_id`,`permission_id`,`granted_at`)
SELECT r.id, p.id, CURRENT_TIMESTAMP(3)
FROM `roles` r
JOIN `permissions` p ON p.code IN ('resilience.view','resilience.manage','resilience.archive')
WHERE r.code='SYSTEM_ADMIN';
