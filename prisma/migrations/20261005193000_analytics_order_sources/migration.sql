CREATE TABLE `order_sources` (
  `id` CHAR(36) NOT NULL,
  `organization_id` CHAR(36) NOT NULL,
  `code` VARCHAR(60) NOT NULL,
  `category` VARCHAR(80) NOT NULL,
  `name_en` VARCHAR(220) NOT NULL,
  `name_ar` VARCHAR(220) NULL,
  `status` ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  `deactivated_at` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `order_sources_org_code_key`(`organization_id`,`code`),
  INDEX `order_sources_org_category_status_idx`(`organization_id`,`category`,`status`),
  CONSTRAINT `order_sources_org_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `order_sources` (
  `id`,`organization_id`,`code`,`category`,`name_en`,`name_ar`,`status`,`created_at`,`updated_at`
)
SELECT UUID(), o.`id`, 'WALK_IN', 'WALK_IN', 'Walk-in', 'مراجع مباشر', 'ACTIVE', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
FROM `organizations` o
WHERE NOT EXISTS (
  SELECT 1 FROM `order_sources` s WHERE s.`organization_id` = o.`id` AND s.`code` = 'WALK_IN'
);

ALTER TABLE `orders`
  ADD COLUMN `source_id` CHAR(36) NULL AFTER `client_id`,
  ADD INDEX `orders_source_ordered_at_idx`(`source_id`,`ordered_at`),
  ADD CONSTRAINT `orders_source_fkey` FOREIGN KEY (`source_id`) REFERENCES `order_sources`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT IGNORE INTO `permissions` (`id`,`code`,`module`,`description`,`created_at`) VALUES
(UUID(),'sources.view','referrers','View order source master data',CURRENT_TIMESTAMP(3)),
(UUID(),'sources.manage','referrers','Manage configurable order source master data',CURRENT_TIMESTAMP(3)),
(UUID(),'analytics.view','analytics','View organization and branch analytics',CURRENT_TIMESTAMP(3));

INSERT IGNORE INTO `role_permissions` (`role_id`,`permission_id`,`granted_at`)
SELECT r.id, p.id, CURRENT_TIMESTAMP(3)
FROM `roles` r
JOIN `permissions` p ON p.code IN ('sources.view','sources.manage','analytics.view')
WHERE r.code='SYSTEM_ADMIN';
