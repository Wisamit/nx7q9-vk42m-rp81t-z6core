CREATE TABLE `notification_templates` (
  `id` CHAR(36) NOT NULL,
  `organization_id` CHAR(36) NOT NULL,
  `branch_id` CHAR(36) NULL,
  `code` VARCHAR(100) NOT NULL,
  `event_type` VARCHAR(120) NOT NULL,
  `channel` ENUM('IN_APP','EMAIL','SMS','WHATSAPP') NOT NULL,
  `locale` VARCHAR(10) NOT NULL DEFAULT 'en',
  `version` INTEGER NOT NULL DEFAULT 1,
  `subject_template` VARCHAR(500) NULL,
  `body_template` TEXT NOT NULL,
  `status` ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  `effective_from` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `effective_to` DATETIME(3) NULL,
  `created_by_user_id` CHAR(36) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  `deactivated_at` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `notification_templates_org_code_version_channel_locale_key`(`organization_id`,`code`,`version`,`channel`,`locale`),
  INDEX `notification_templates_event_idx`(`organization_id`,`event_type`,`channel`,`locale`,`status`,`effective_from`,`effective_to`),
  INDEX `notification_templates_branch_event_idx`(`branch_id`,`event_type`,`status`),
  CONSTRAINT `notification_templates_org_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `notification_templates_branch_fkey` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `notification_templates_creator_fkey` FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `notification_events` (
  `id` CHAR(36) NOT NULL,
  `organization_id` CHAR(36) NOT NULL,
  `branch_id` CHAR(36) NULL,
  `event_type` VARCHAR(120) NOT NULL,
  `entity_type` VARCHAR(100) NOT NULL,
  `entity_id` CHAR(36) NOT NULL,
  `severity` ENUM('INFO','WARNING','CRITICAL') NOT NULL DEFAULT 'INFO',
  `payload` JSON NOT NULL,
  `created_by_user_id` CHAR(36) NULL,
  `occurred_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `notification_events_org_event_time_idx`(`organization_id`,`event_type`,`occurred_at`),
  INDEX `notification_events_branch_event_time_idx`(`branch_id`,`event_type`,`occurred_at`),
  INDEX `notification_events_entity_idx`(`entity_type`,`entity_id`),
  CONSTRAINT `notification_events_org_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `notification_events_branch_fkey` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `notification_events_creator_fkey` FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `notification_deliveries` (
  `id` CHAR(36) NOT NULL,
  `organization_id` CHAR(36) NOT NULL,
  `event_id` CHAR(36) NOT NULL,
  `template_id` CHAR(36) NULL,
  `recipient_type` ENUM('USER','PORTAL_ACCOUNT','PATIENT','REFERRER','CLIENT','EXTERNAL') NOT NULL,
  `recipient_id` CHAR(36) NULL,
  `recipient_user_id` CHAR(36) NULL,
  `recipient_address` VARCHAR(255) NULL,
  `channel` ENUM('IN_APP','EMAIL','SMS','WHATSAPP') NOT NULL,
  `locale` VARCHAR(10) NOT NULL DEFAULT 'en',
  `subject` VARCHAR(500) NULL,
  `body` TEXT NOT NULL,
  `status` ENUM('QUEUED','SENT','DELIVERED','FAILED','SKIPPED') NOT NULL DEFAULT 'QUEUED',
  `attempt_count` INTEGER NOT NULL DEFAULT 0,
  `next_attempt_at` DATETIME(3) NULL,
  `last_attempt_at` DATETIME(3) NULL,
  `sent_at` DATETIME(3) NULL,
  `delivered_at` DATETIME(3) NULL,
  `read_at` DATETIME(3) NULL,
  `provider_message_id` VARCHAR(255) NULL,
  `last_error` TEXT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `notification_deliveries_event_recipient_key`(`event_id`,`channel`,`recipient_type`,`recipient_id`),
  INDEX `notification_deliveries_queue_idx`(`organization_id`,`channel`,`status`,`next_attempt_at`),
  INDEX `notification_deliveries_user_inbox_idx`(`recipient_user_id`,`channel`,`read_at`,`created_at`),
  INDEX `notification_deliveries_recipient_idx`(`recipient_type`,`recipient_id`,`channel`,`status`),
  CONSTRAINT `notification_deliveries_org_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `notification_deliveries_event_fkey` FOREIGN KEY (`event_id`) REFERENCES `notification_events`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `notification_deliveries_template_fkey` FOREIGN KEY (`template_id`) REFERENCES `notification_templates`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `notification_deliveries_user_fkey` FOREIGN KEY (`recipient_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `notification_preferences` (
  `id` CHAR(36) NOT NULL,
  `organization_id` CHAR(36) NOT NULL,
  `recipient_type` ENUM('USER','PORTAL_ACCOUNT','PATIENT','REFERRER','CLIENT','EXTERNAL') NOT NULL,
  `recipient_id` CHAR(36) NOT NULL,
  `event_type` VARCHAR(120) NOT NULL,
  `channel` ENUM('IN_APP','EMAIL','SMS','WHATSAPP') NOT NULL,
  `enabled` BOOLEAN NOT NULL DEFAULT true,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `notification_preferences_recipient_event_channel_key`(`organization_id`,`recipient_type`,`recipient_id`,`event_type`,`channel`),
  INDEX `notification_preferences_event_idx`(`organization_id`,`event_type`,`channel`,`enabled`),
  CONSTRAINT `notification_preferences_org_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `permissions` (`id`,`code`,`module`,`description`,`created_at`)
VALUES
(UUID(), 'notifications.view', 'notifications', 'View notification inbox and delivery history', CURRENT_TIMESTAMP(3)),
(UUID(), 'notifications.manage', 'notifications', 'Manage notification templates and preferences', CURRENT_TIMESTAMP(3)),
(UUID(), 'notifications.dispatch', 'notifications', 'Retry and dispatch queued notification deliveries', CURRENT_TIMESTAMP(3))
ON DUPLICATE KEY UPDATE `module` = VALUES(`module`), `description` = VALUES(`description`);

INSERT IGNORE INTO `role_permissions` (`role_id`, `permission_id`)
SELECT r.id, p.id
FROM `roles` r
JOIN `permissions` p ON p.code IN ('notifications.view','notifications.manage','notifications.dispatch')
WHERE r.code = 'SYSTEM_ADMIN';
