CREATE TABLE `test_panels` (
  `id` CHAR(36) NOT NULL, `organization_id` CHAR(36) NOT NULL, `code` VARCHAR(80) NOT NULL,
  `name_en` VARCHAR(200) NOT NULL, `name_ar` VARCHAR(200) NULL, `description_en` TEXT NULL, `description_ar` TEXT NULL,
  `status` ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updated_at` DATETIME(3) NOT NULL, `deactivated_at` DATETIME(3) NULL,
  UNIQUE INDEX `test_panels_organization_id_code_key`(`organization_id`,`code`),
  INDEX `test_panels_organization_id_status_idx`(`organization_id`,`status`), PRIMARY KEY(`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `test_panel_items` (
  `panel_id` CHAR(36) NOT NULL, `test_id` CHAR(36) NOT NULL, `display_order` INTEGER NOT NULL DEFAULT 0,
  `required` BOOLEAN NOT NULL DEFAULT true, `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `test_panel_items_test_id_idx`(`test_id`), PRIMARY KEY(`panel_id`,`test_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `test_panels` ADD CONSTRAINT `test_panels_organization_id_fkey` FOREIGN KEY(`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `test_panel_items` ADD CONSTRAINT `test_panel_items_panel_id_fkey` FOREIGN KEY(`panel_id`) REFERENCES `test_panels`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `test_panel_items` ADD CONSTRAINT `test_panel_items_test_id_fkey` FOREIGN KEY(`test_id`) REFERENCES `lab_tests`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
