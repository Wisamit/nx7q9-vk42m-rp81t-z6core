CREATE TABLE `analyzers` (
  `id` CHAR(36) NOT NULL,
  `organization_id` CHAR(36) NOT NULL,
  `branch_id` CHAR(36) NOT NULL,
  `department_id` CHAR(36) NULL,
  `code` VARCHAR(80) NOT NULL,
  `name` VARCHAR(200) NOT NULL,
  `manufacturer` VARCHAR(150) NULL,
  `model` VARCHAR(150) NULL,
  `serial_number` VARCHAR(150) NULL,
  `protocol` ENUM('ASTM','HL7_V2','FILE','CSV','HTTP') NOT NULL,
  `transport` ENUM('SERIAL','TCP_CLIENT','TCP_SERVER','WATCH_FOLDER','HTTP') NOT NULL,
  `bridge_device_key` VARCHAR(150) NULL,
  `status` ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  `deactivated_at` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `analyzers_organization_code_key`(`organization_id`,`code`),
  INDEX `analyzers_branch_status_idx`(`branch_id`,`status`),
  INDEX `analyzers_department_status_idx`(`department_id`,`status`),
  CONSTRAINT `analyzers_organization_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `analyzers_branch_fkey` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `analyzers_department_fkey` FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `analyzer_credentials` (
  `id` CHAR(36) NOT NULL,
  `analyzer_id` CHAR(36) NOT NULL,
  `name` VARCHAR(150) NOT NULL,
  `token_prefix` VARCHAR(20) NOT NULL,
  `token_hash` CHAR(64) NOT NULL,
  `status` ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  `expires_at` DATETIME(3) NULL,
  `last_used_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  `deactivated_at` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `analyzer_credentials_token_hash_key`(`token_hash`),
  INDEX `analyzer_credentials_analyzer_status_idx`(`analyzer_id`,`status`),
  CONSTRAINT `analyzer_credentials_analyzer_fkey` FOREIGN KEY (`analyzer_id`) REFERENCES `analyzers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `analyzer_test_mappings` (
  `id` CHAR(36) NOT NULL,
  `analyzer_id` CHAR(36) NOT NULL,
  `analyzer_test_code` VARCHAR(120) NOT NULL,
  `analyzer_unit_code` VARCHAR(80) NULL,
  `test_id` CHAR(36) NOT NULL,
  `component_id` CHAR(36) NULL,
  `effective_from` DATETIME(3) NOT NULL,
  `effective_to` DATETIME(3) NULL,
  `status` ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  `deactivated_at` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `analyzer_test_mappings_code_from_key`(`analyzer_id`,`analyzer_test_code`,`effective_from`),
  INDEX `analyzer_test_mappings_target_status_dates_idx`(`test_id`,`component_id`,`status`,`effective_from`,`effective_to`),
  INDEX `analyzer_test_mappings_analyzer_status_dates_idx`(`analyzer_id`,`status`,`effective_from`,`effective_to`),
  CONSTRAINT `analyzer_test_mappings_analyzer_fkey` FOREIGN KEY (`analyzer_id`) REFERENCES `analyzers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `analyzer_test_mappings_test_fkey` FOREIGN KEY (`test_id`) REFERENCES `lab_tests`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `analyzer_test_mappings_component_fkey` FOREIGN KEY (`component_id`) REFERENCES `test_components`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `analyzer_messages` (
  `id` CHAR(36) NOT NULL,
  `analyzer_id` CHAR(36) NOT NULL,
  `branch_id` CHAR(36) NOT NULL,
  `direction` ENUM('INBOUND','OUTBOUND') NOT NULL DEFAULT 'INBOUND',
  `protocol` ENUM('ASTM','HL7_V2','FILE','CSV','HTTP') NOT NULL,
  `bridge_message_id` VARCHAR(150) NOT NULL,
  `payload_hash` CHAR(64) NOT NULL,
  `raw_payload` LONGTEXT NOT NULL,
  `status` ENUM('RECEIVED','PROCESSED','ERROR','DEAD_LETTER','IGNORED') NOT NULL DEFAULT 'RECEIVED',
  `attempts` INT NOT NULL DEFAULT 0,
  `error_code` VARCHAR(120) NULL,
  `error_text` TEXT NULL,
  `received_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `processed_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `analyzer_messages_bridge_message_key`(`analyzer_id`,`bridge_message_id`),
  INDEX `analyzer_messages_branch_status_received_idx`(`branch_id`,`status`,`received_at`),
  INDEX `analyzer_messages_analyzer_status_received_idx`(`analyzer_id`,`status`,`received_at`),
  CONSTRAINT `analyzer_messages_analyzer_fkey` FOREIGN KEY (`analyzer_id`) REFERENCES `analyzers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `analyzer_messages_branch_fkey` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `analyzer_result_imports` (
  `id` CHAR(36) NOT NULL,
  `message_id` CHAR(36) NOT NULL,
  `analyzer_id` CHAR(36) NOT NULL,
  `mapping_id` CHAR(36) NULL,
  `order_item_id` CHAR(36) NULL,
  `specimen_id` CHAR(36) NULL,
  `result_id` CHAR(36) NULL,
  `barcode_snapshot` VARCHAR(80) NULL,
  `analyzer_test_code` VARCHAR(120) NOT NULL,
  `raw_value` VARCHAR(1000) NOT NULL,
  `raw_unit` VARCHAR(80) NULL,
  `status` ENUM('RECEIVED','MAPPED','IMPORTED','REJECTED','ERROR') NOT NULL DEFAULT 'RECEIVED',
  `error_text` TEXT NULL,
  `imported_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `analyzer_result_imports_message_status_idx`(`message_id`,`status`),
  INDEX `analyzer_result_imports_analyzer_status_created_idx`(`analyzer_id`,`status`,`created_at`),
  INDEX `analyzer_result_imports_order_item_status_idx`(`order_item_id`,`status`),
  INDEX `analyzer_result_imports_specimen_status_idx`(`specimen_id`,`status`),
  CONSTRAINT `analyzer_result_imports_message_fkey` FOREIGN KEY (`message_id`) REFERENCES `analyzer_messages`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `analyzer_result_imports_analyzer_fkey` FOREIGN KEY (`analyzer_id`) REFERENCES `analyzers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `analyzer_result_imports_mapping_fkey` FOREIGN KEY (`mapping_id`) REFERENCES `analyzer_test_mappings`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `analyzer_result_imports_order_item_fkey` FOREIGN KEY (`order_item_id`) REFERENCES `order_items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `analyzer_result_imports_specimen_fkey` FOREIGN KEY (`specimen_id`) REFERENCES `specimens`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `analyzer_result_imports_result_fkey` FOREIGN KEY (`result_id`) REFERENCES `laboratory_results`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT IGNORE INTO `permissions` (`id`,`code`,`module`,`description`,`created_at`) VALUES
(UUID(),'analyzers.view','integrations','View analyzers, mappings and interface messages',CURRENT_TIMESTAMP(3)),
(UUID(),'analyzers.manage','integrations','Manage analyzers, bridge credentials and mappings',CURRENT_TIMESTAMP(3)),
(UUID(),'analyzers.replay','integrations','Replay analyzer interface messages and error queue items',CURRENT_TIMESTAMP(3));

INSERT IGNORE INTO `role_permissions` (`role_id`,`permission_id`,`granted_at`)
SELECT r.id, p.id, CURRENT_TIMESTAMP(3)
FROM `roles` r
JOIN `permissions` p ON p.code IN ('analyzers.view','analyzers.manage','analyzers.replay')
WHERE r.code='SYSTEM_ADMIN';
