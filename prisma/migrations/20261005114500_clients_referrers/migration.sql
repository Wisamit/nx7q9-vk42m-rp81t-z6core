CREATE TABLE `clients` (
  `id` CHAR(36) NOT NULL,
  `organization_id` CHAR(36) NOT NULL,
  `code` VARCHAR(60) NOT NULL,
  `type` ENUM('INDIVIDUAL','CLINIC','HOSPITAL','COMPANY','INSURANCE','OTHER') NOT NULL DEFAULT 'OTHER',
  `name_en` VARCHAR(220) NOT NULL,
  `name_ar` VARCHAR(220) NULL,
  `phone` VARCHAR(50) NULL,
  `email` VARCHAR(191) NULL,
  `address_en` TEXT NULL,
  `address_ar` TEXT NULL,
  `payment_terms_days` INT NULL,
  `status` ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  `deactivated_at` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `clients_org_code_key`(`organization_id`,`code`),
  INDEX `clients_org_name_idx`(`organization_id`,`name_en`),
  CONSTRAINT `clients_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `referrers` (
  `id` CHAR(36) NOT NULL,
  `organization_id` CHAR(36) NOT NULL,
  `client_id` CHAR(36) NULL,
  `code` VARCHAR(60) NOT NULL,
  `type` ENUM('PHYSICIAN','CLINIC','HOSPITAL','OTHER') NOT NULL DEFAULT 'PHYSICIAN',
  `name_en` VARCHAR(220) NOT NULL,
  `name_ar` VARCHAR(220) NULL,
  `phone` VARCHAR(50) NULL,
  `email` VARCHAR(191) NULL,
  `license_number` VARCHAR(100) NULL,
  `status` ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  `deactivated_at` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `referrers_org_code_key`(`organization_id`,`code`),
  INDEX `referrers_org_name_idx`(`organization_id`,`name_en`),
  INDEX `referrers_client_status_idx`(`client_id`,`status`),
  CONSTRAINT `referrers_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `referrers_client_id_fkey` FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT IGNORE INTO `permissions` (`id`,`code`,`module`,`description`,`created_at`) VALUES
(UUID(),'clients.view','clients','View client accounts',CURRENT_TIMESTAMP(3)),
(UUID(),'clients.manage','clients','Manage client accounts',CURRENT_TIMESTAMP(3)),
(UUID(),'referrers.view','referrers','View referrers',CURRENT_TIMESTAMP(3)),
(UUID(),'referrers.manage','referrers','Manage referrers',CURRENT_TIMESTAMP(3));

INSERT IGNORE INTO `role_permissions` (`role_id`,`permission_id`,`granted_at`)
SELECT r.id, p.id, CURRENT_TIMESTAMP(3)
FROM `roles` r
JOIN `permissions` p ON p.code IN ('clients.view','clients.manage','referrers.view','referrers.manage')
WHERE r.code='SYSTEM_ADMIN';
