-- Controlled legacy/catalog import staging.
CREATE TABLE `catalog_import_batches` (
  `id` CHAR(36) NOT NULL,
  `organization_id` CHAR(36) NOT NULL,
  `source_type` VARCHAR(40) NOT NULL,
  `source_name` VARCHAR(255) NOT NULL,
  `source_checksum` CHAR(64) NULL,
  `status` ENUM('DRAFT','VALIDATED','IMPORTED','FAILED') NOT NULL DEFAULT 'DRAFT',
  `summary` JSON NULL,
  `created_by_user_id` CHAR(36) NOT NULL,
  `validated_at` DATETIME(3) NULL,
  `imported_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `catalog_import_batches_organization_id_created_at_idx`(`organization_id`, `created_at`),
  CONSTRAINT `catalog_import_batches_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `catalog_import_rows` (
  `id` CHAR(36) NOT NULL,
  `batch_id` CHAR(36) NOT NULL,
  `row_number` INTEGER NOT NULL,
  `entity_type` VARCHAR(40) NOT NULL,
  `legacy_key` VARCHAR(255) NULL,
  `status` ENUM('PENDING','VALID','WARNING','ERROR','IMPORTED','SKIPPED') NOT NULL DEFAULT 'PENDING',
  `source_data` JSON NOT NULL,
  `normalized_data` JSON NULL,
  `validation_issues` JSON NULL,
  `imported_entity_id` CHAR(36) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `catalog_import_rows_batch_id_row_number_key`(`batch_id`, `row_number`),
  INDEX `catalog_import_rows_batch_id_status_idx`(`batch_id`, `status`),
  INDEX `catalog_import_rows_entity_type_legacy_key_idx`(`entity_type`, `legacy_key`),
  CONSTRAINT `catalog_import_rows_batch_id_fkey` FOREIGN KEY (`batch_id`) REFERENCES `catalog_import_batches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
