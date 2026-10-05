CREATE TABLE `terminology_mappings` (
  `id` CHAR(36) NOT NULL,
  `organization_id` CHAR(36) NOT NULL,
  `scope` ENUM('TEST','COMPONENT') NOT NULL,
  `test_id` CHAR(36) NOT NULL,
  `component_id` CHAR(36) NULL,
  `system` ENUM('LOINC','SNOMED_CT','ICD10','LOCAL') NOT NULL DEFAULT 'LOINC',
  `code` VARCHAR(80) NOT NULL,
  `display` VARCHAR(255) NULL,
  `system_version` VARCHAR(80) NULL,
  `is_primary` BOOLEAN NOT NULL DEFAULT true,
  `effective_from` DATETIME(3) NOT NULL,
  `effective_to` DATETIME(3) NULL,
  `status` ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  `created_by_user_id` CHAR(36) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  `deactivated_at` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  INDEX `terminology_mappings_org_system_code_status_idx`(`organization_id`,`system`,`code`,`status`),
  INDEX `terminology_mappings_test_component_system_status_dates_idx`(`test_id`,`component_id`,`system`,`status`,`effective_from`,`effective_to`),
  CONSTRAINT `terminology_mappings_org_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `terminology_mappings_test_fkey` FOREIGN KEY (`test_id`) REFERENCES `lab_tests`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `terminology_mappings_component_fkey` FOREIGN KEY (`component_id`) REFERENCES `test_components`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `terminology_mappings_creator_fkey` FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `integration_endpoints` (
  `id` CHAR(36) NOT NULL,
  `organization_id` CHAR(36) NOT NULL,
  `branch_id` CHAR(36) NULL,
  `code` VARCHAR(80) NOT NULL,
  `name` VARCHAR(220) NOT NULL,
  `endpoint_type` ENUM('FHIR_R4','HL7_V2','REST','WEBHOOK') NOT NULL,
  `direction` ENUM('INBOUND','OUTBOUND','BIDIRECTIONAL') NOT NULL,
  `base_url` VARCHAR(1000) NULL,
  `auth_type` ENUM('NONE','API_KEY','BEARER','BASIC','HMAC') NOT NULL DEFAULT 'NONE',
  `secret_reference` VARCHAR(500) NULL,
  `timeout_seconds` INTEGER NOT NULL DEFAULT 15,
  `max_attempts` INTEGER NOT NULL DEFAULT 5,
  `status` ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  `created_by_user_id` CHAR(36) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  `deactivated_at` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `integration_endpoints_org_code_key`(`organization_id`,`code`),
  INDEX `integration_endpoints_branch_type_status_idx`(`branch_id`,`endpoint_type`,`status`),
  CONSTRAINT `integration_endpoints_org_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `integration_endpoints_branch_fkey` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `integration_endpoints_creator_fkey` FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `integration_api_keys` (
  `id` CHAR(36) NOT NULL,
  `organization_id` CHAR(36) NOT NULL,
  `endpoint_id` CHAR(36) NOT NULL,
  `name` VARCHAR(160) NOT NULL,
  `key_prefix` VARCHAR(32) NOT NULL,
  `key_hash` CHAR(64) NOT NULL,
  `scopes` JSON NOT NULL,
  `expires_at` DATETIME(3) NULL,
  `last_used_at` DATETIME(3) NULL,
  `revoked_at` DATETIME(3) NULL,
  `created_by_user_id` CHAR(36) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `integration_api_keys_prefix_key`(`key_prefix`),
  INDEX `integration_api_keys_endpoint_revoked_expires_idx`(`endpoint_id`,`revoked_at`,`expires_at`),
  CONSTRAINT `integration_api_keys_org_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `integration_api_keys_endpoint_fkey` FOREIGN KEY (`endpoint_id`) REFERENCES `integration_endpoints`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `integration_api_keys_creator_fkey` FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `integration_messages` (
  `id` CHAR(36) NOT NULL,
  `organization_id` CHAR(36) NOT NULL,
  `branch_id` CHAR(36) NULL,
  `endpoint_id` CHAR(36) NOT NULL,
  `direction` ENUM('INBOUND','OUTBOUND') NOT NULL,
  `message_type` VARCHAR(100) NOT NULL,
  `control_id` VARCHAR(120) NULL,
  `order_id` CHAR(36) NULL,
  `report_version_id` CHAR(36) NULL,
  `payload_text` LONGTEXT NULL,
  `payload_json` JSON NULL,
  `payload_hash` CHAR(64) NOT NULL,
  `status` ENUM('QUEUED','SENT','ACKNOWLEDGED','RECEIVED','PROCESSED','REJECTED','FAILED','DEAD_LETTER') NOT NULL DEFAULT 'QUEUED',
  `attempt_count` INTEGER NOT NULL DEFAULT 0,
  `next_attempt_at` DATETIME(3) NULL,
  `acknowledgement_code` VARCHAR(40) NULL,
  `acknowledgement_payload` TEXT NULL,
  `last_error` TEXT NULL,
  `received_at` DATETIME(3) NULL,
  `processed_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `integration_messages_endpoint_status_created_idx`(`endpoint_id`,`status`,`created_at`),
  INDEX `integration_messages_order_created_idx`(`order_id`,`created_at`),
  INDEX `integration_messages_report_created_idx`(`report_version_id`,`created_at`),
  INDEX `integration_messages_control_idx`(`control_id`),
  CONSTRAINT `integration_messages_org_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `integration_messages_branch_fkey` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `integration_messages_endpoint_fkey` FOREIGN KEY (`endpoint_id`) REFERENCES `integration_endpoints`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `integration_messages_order_fkey` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `integration_messages_report_fkey` FOREIGN KEY (`report_version_id`) REFERENCES `diagnostic_report_versions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `webhook_subscriptions` (
  `id` CHAR(36) NOT NULL,
  `organization_id` CHAR(36) NOT NULL,
  `endpoint_id` CHAR(36) NOT NULL,
  `event_type` VARCHAR(120) NOT NULL,
  `status` ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `webhook_subscriptions_endpoint_event_key`(`endpoint_id`,`event_type`),
  INDEX `webhook_subscriptions_org_event_status_idx`(`organization_id`,`event_type`,`status`),
  CONSTRAINT `webhook_subscriptions_org_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `webhook_subscriptions_endpoint_fkey` FOREIGN KEY (`endpoint_id`) REFERENCES `integration_endpoints`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `webhook_deliveries` (
  `id` CHAR(36) NOT NULL,
  `organization_id` CHAR(36) NOT NULL,
  `subscription_id` CHAR(36) NOT NULL,
  `report_version_id` CHAR(36) NULL,
  `event_type` VARCHAR(120) NOT NULL,
  `payload` JSON NOT NULL,
  `payload_hash` CHAR(64) NOT NULL,
  `status` ENUM('QUEUED','SENT','DELIVERED','FAILED','DEAD_LETTER') NOT NULL DEFAULT 'QUEUED',
  `attempt_count` INTEGER NOT NULL DEFAULT 0,
  `next_attempt_at` DATETIME(3) NULL,
  `last_http_status` INTEGER NULL,
  `last_error` TEXT NULL,
  `delivered_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `webhook_deliveries_status_next_created_idx`(`status`,`next_attempt_at`,`created_at`),
  INDEX `webhook_deliveries_subscription_created_idx`(`subscription_id`,`created_at`),
  INDEX `webhook_deliveries_report_created_idx`(`report_version_id`,`created_at`),
  CONSTRAINT `webhook_deliveries_org_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `webhook_deliveries_subscription_fkey` FOREIGN KEY (`subscription_id`) REFERENCES `webhook_subscriptions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `webhook_deliveries_report_fkey` FOREIGN KEY (`report_version_id`) REFERENCES `diagnostic_report_versions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT IGNORE INTO `permissions` (`id`,`code`,`module`,`description`,`created_at`) VALUES
(UUID(),'integrations.view','integrations','View interoperability endpoints, mappings and message logs',CURRENT_TIMESTAMP(3)),
(UUID(),'integrations.manage','integrations','Manage interoperability endpoints, terminology mappings and webhook subscriptions',CURRENT_TIMESTAMP(3)),
(UUID(),'integrations.api_keys.manage','integrations','Create and revoke external integration API keys',CURRENT_TIMESTAMP(3)),
(UUID(),'integrations.replay','integrations','Retry failed outbound integration messages and webhook deliveries',CURRENT_TIMESTAMP(3));

INSERT IGNORE INTO `role_permissions` (`role_id`,`permission_id`,`granted_at`)
SELECT r.id, p.id, CURRENT_TIMESTAMP(3)
FROM `roles` r
JOIN `permissions` p ON p.code IN ('integrations.view','integrations.manage','integrations.api_keys.manage','integrations.replay')
WHERE r.code='SYSTEM_ADMIN';
