CREATE TABLE `organization_settings` (
  `id` CHAR(36) NOT NULL,
  `organization_id` CHAR(36) NOT NULL,
  `system_name_en` VARCHAR(200) NULL,
  `system_name_ar` VARCHAR(200) NULL,
  `logo_data_url` MEDIUMTEXT NULL,
  `favicon_data_url` MEDIUMTEXT NULL,
  `default_theme` VARCHAR(20) NOT NULL DEFAULT 'SYSTEM',
  `date_format` VARCHAR(40) NOT NULL DEFAULT 'DD/MM/YYYY',
  `time_format` VARCHAR(10) NOT NULL DEFAULT '12',
  `show_seconds` BOOLEAN NOT NULL DEFAULT false,
  `default_locale` VARCHAR(10) NOT NULL DEFAULT 'en',
  `week_starts_on` INTEGER NOT NULL DEFAULT 1,
  `density` VARCHAR(20) NOT NULL DEFAULT 'COMFORTABLE',
  `light_theme` JSON NULL,
  `dark_theme` JSON NULL,
  `developer_credit` VARCHAR(200) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `organization_settings_organization_id_key`(`organization_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `organization_settings`
  ADD CONSTRAINT `organization_settings_organization_id_fkey`
  FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE;
