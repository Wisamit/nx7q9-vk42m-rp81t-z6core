CREATE TABLE `notification_templates` (
  `id` CHAR(36) NOT NULL,
  `organization_id` CHAR(36) NOT NULL,
  `code` VARCHAR(100) NOT NULL,
  `event_code` VARCHAR(120) NOT NULL,
  `channel` ENUM('IN_APP','EMAIL','SMS','WHATSAPP') NOT NULL,
  `subject_en` VARCHAR(255) NULL,
  `subject_ar` VARCHAR(255) NULL,
  `body_en` TEXT NOT NULL,
  `body_ar` TEXT NULL,
  `enabled` BOOLEAN NOT NULL DEFAULT true,
  `created_by_user_id` CHAR(36) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `notification_templates_org_code_key`(`organization_id`,`code`),
  INDEX `notification_templates_org_event_channel_idx`(`organization_id`,`event_code`,`channel`,`enabled`),
  CONSTRAINT `notification_templates_org_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `notification_templates_creator_fkey` FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `notification_preferences` (
  `id` CHAR(36) NOT NULL,
  `organization_id` CHAR(36) NOT NULL,
  `user_id` CHAR(36) NOT NULL,
  `event_code` VARCHAR(120) NOT NULL,
  `channel` ENUM('IN_APP','EMAIL','SMS','WHATSAPP') NOT NULL,
  `enabled` BOOLEAN NOT NULL DEFAULT true,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `notification_preferences_user_event_channel_key`(`user_id`,`event_code`,`channel`),
  INDEX `notification_preferences_org_event_channel_idx`(`organization_id`,`event_code`,`channel`),
  CONSTRAINT `notification_preferences_org_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `notification_preferences_user_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `notifications` (
  `id` CHAR(36) NOT NULL,
  `organization_id` CHAR(36) NOT NULL,
  `branch_id` CHAR(36) NULL,
  `event_code` VARCHAR(120) NOT NULL,
  `recipient_type` ENUM('USER','PATIENT','REFERRER','CLIENT','EXTERNAL') NOT NULL,
  `recipient_user_id` CHAR(36) NULL,
  `recipient_reference_id` VARCHAR(100) NULL,
  `title` VARCHAR(255) NOT NULL,
  `body` TEXT NOT NULL,
  `severity` ENUM('INFO','SUCCESS','WARNING','CRITICAL') NOT NULL DEFAULT 'INFO',
  `entity_type` VARCHAR(100) NULL,
  `entity_id` VARCHAR(100) NULL,
  `metadata` JSON NULL,
  `read_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `notifications_org_created_idx`(`organization_id`,`created_at`),
  INDEX `notifications_branch_created_idx`(`branch_id`,`created_at`),
  INDEX `notifications_recipient_read_created_idx`(`recipient_user_id`,`read_at`,`created_at`),
  INDEX `notifications_event_created_idx`(`event_code`,`created_at`),
  CONSTRAINT `notifications_org_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `notifications_branch_fkey` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `notifications_recipient_user_fkey` FOREIGN KEY (`recipient_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `notification_deliveries` (
  `id` CHAR(36) NOT NULL,
  `notification_id` CHAR(36) NOT NULL,
  `channel` ENUM('IN_APP','EMAIL','SMS','WHATSAPP') NOT NULL,
  `destination` VARCHAR(500) NULL,
  `provider` VARCHAR(100) NULL,
  `status` ENUM('PENDING','SENT','FAILED','DEAD_LETTER','SKIPPED') NOT NULL DEFAULT 'PENDING',
  `attempt_count` INTEGER NOT NULL DEFAULT 0,
  `max_attempts` INTEGER NOT NULL DEFAULT 5,
  `next_attempt_at` DATETIME(3) NULL,
  `sent_at` DATETIME(3) NULL,
  `provider_message_id` VARCHAR(255) NULL,
  `last_error` TEXT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `notification_deliveries_status_retry_idx`(`status`,`next_attempt_at`,`created_at`),
  INDEX `notification_deliveries_notification_channel_idx`(`notification_id`,`channel`),
  CONSTRAINT `notification_deliveries_notification_fkey` FOREIGN KEY (`notification_id`) REFERENCES `notifications`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT IGNORE INTO `permissions` (`id`,`code`,`module`,`description`,`created_at`) VALUES
(UUID(),'notifications.view','notifications','View personal and branch-scoped notifications',CURRENT_TIMESTAMP(3)),
(UUID(),'notifications.manage','notifications','Manage notification templates and preferences',CURRENT_TIMESTAMP(3)),
(UUID(),'notifications.dispatch','notifications','Dispatch and retry outbound notification deliveries',CURRENT_TIMESTAMP(3));

INSERT IGNORE INTO `role_permissions` (`role_id`,`permission_id`,`granted_at`)
SELECT r.id, p.id, CURRENT_TIMESTAMP(3)
FROM `roles` r
JOIN `permissions` p ON p.code IN ('notifications.view','notifications.manage','notifications.dispatch')
WHERE r.code='SYSTEM_ADMIN';
