CREATE TABLE `report_templates` (
  `id` CHAR(36) NOT NULL,
  `organization_id` CHAR(36) NOT NULL,
  `branch_id` CHAR(36) NULL,
  `code` VARCHAR(100) NOT NULL,
  `name_en` VARCHAR(200) NOT NULL,
  `name_ar` VARCHAR(200) NULL,
  `is_default` BOOLEAN NOT NULL DEFAULT false,
  `status` ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  `created_by_user_id` CHAR(36) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  `deactivated_at` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `report_templates_org_code_key`(`organization_id`,`code`),
  INDEX `report_templates_org_branch_status_idx`(`organization_id`,`branch_id`,`status`),
  INDEX `report_templates_branch_default_status_idx`(`branch_id`,`is_default`,`status`),
  CONSTRAINT `report_templates_org_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `report_templates_branch_fkey` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `report_templates_creator_fkey` FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `report_template_versions` (
  `id` CHAR(36) NOT NULL,
  `template_id` CHAR(36) NOT NULL,
  `version` INTEGER NOT NULL,
  `status` ENUM('DRAFT','APPROVED','EFFECTIVE','RETIRED') NOT NULL DEFAULT 'DRAFT',
  `configuration` JSON NOT NULL,
  `change_summary` VARCHAR(1000) NOT NULL,
  `submitted_by_user_id` CHAR(36) NOT NULL,
  `approved_by_user_id` CHAR(36) NULL,
  `approved_at` DATETIME(3) NULL,
  `effective_from` DATETIME(3) NULL,
  `effective_to` DATETIME(3) NULL,
  `retired_at` DATETIME(3) NULL,
  `supersedes_version_id` CHAR(36) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `report_template_versions_template_version_key`(`template_id`,`version`),
  INDEX `report_template_versions_template_status_effective_idx`(`template_id`,`status`,`effective_from`),
  INDEX `report_template_versions_status_window_idx`(`status`,`effective_from`,`effective_to`),
  CONSTRAINT `report_template_versions_template_fkey` FOREIGN KEY (`template_id`) REFERENCES `report_templates`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `report_template_versions_submitter_fkey` FOREIGN KEY (`submitted_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `report_template_versions_approver_fkey` FOREIGN KEY (`approved_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `report_template_versions_supersedes_fkey` FOREIGN KEY (`supersedes_version_id`) REFERENCES `report_template_versions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `diagnostic_report_versions`
  ADD COLUMN `report_template_version_id` CHAR(36) NULL,
  ADD COLUMN `template_snapshot` JSON NULL,
  ADD INDEX `diagnostic_report_versions_template_version_idx`(`report_template_version_id`),
  ADD CONSTRAINT `diagnostic_report_versions_template_version_fkey` FOREIGN KEY (`report_template_version_id`) REFERENCES `report_template_versions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT IGNORE INTO `permissions` (`id`,`code`,`module`,`description`,`created_at`) VALUES
(UUID(),'report_templates.view','reporting','View report template configuration and version history',CURRENT_TIMESTAMP(3)),
(UUID(),'report_templates.manage','reporting','Manage and approve versioned report templates',CURRENT_TIMESTAMP(3));

INSERT IGNORE INTO `role_permissions` (`role_id`,`permission_id`,`granted_at`)
SELECT r.id, p.id, CURRENT_TIMESTAMP(3)
FROM `roles` r
JOIN `permissions` p ON p.code IN ('report_templates.view','report_templates.manage')
WHERE r.code='SYSTEM_ADMIN';
