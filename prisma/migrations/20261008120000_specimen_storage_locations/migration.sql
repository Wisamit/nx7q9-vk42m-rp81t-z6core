CREATE TABLE `specimen_storage_locations` (
  `id` CHAR(36) NOT NULL,
  `organization_id` CHAR(36) NOT NULL,
  `branch_id` CHAR(36) NOT NULL,
  `path` VARCHAR(200) NOT NULL,
  `zone` VARCHAR(40) NOT NULL,
  `unit` VARCHAR(40) NOT NULL,
  `rack` VARCHAR(40) NOT NULL,
  `slot` VARCHAR(40) NOT NULL,
  `status` ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `specimen_storage_locations_branch_id_path_key` (`branch_id`, `path`),
  INDEX `specimen_storage_locations_organization_id_branch_id_status_idx` (`organization_id`, `branch_id`, `status`),
  CONSTRAINT `specimen_storage_locations_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `specimen_storage_locations_branch_id_fkey` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
