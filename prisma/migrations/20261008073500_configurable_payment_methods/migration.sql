CREATE TABLE `payment_method_configs` (
  `id` CHAR(36) NOT NULL,
  `organization_id` CHAR(36) NOT NULL,
  `code` VARCHAR(60) NOT NULL,
  `name_en` VARCHAR(160) NOT NULL,
  `name_ar` VARCHAR(160) NULL,
  `base_method` ENUM('CASH','CARD','BANK_TRANSFER','ONLINE','CREDIT_ACCOUNT','OTHER') NOT NULL,
  `is_settlement` BOOLEAN NOT NULL DEFAULT TRUE,
  `requires_reference` BOOLEAN NOT NULL DEFAULT FALSE,
  `sort_order` INT NOT NULL DEFAULT 0,
  `status` ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  `deactivated_at` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `payment_method_configs_org_code_key`(`organization_id`,`code`),
  INDEX `payment_method_configs_org_status_sort_idx`(`organization_id`,`status`,`sort_order`),
  CONSTRAINT `payment_method_configs_org_fkey`
    FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `payment_method_configs`
  (`id`,`organization_id`,`code`,`name_en`,`name_ar`,`base_method`,`is_settlement`,`requires_reference`,`sort_order`,`status`,`created_at`,`updated_at`)
SELECT UUID(), o.`id`, 'CASH', 'Cash', 'نقدي', 'CASH', TRUE, FALSE, 10, 'ACTIVE', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
FROM `organizations` o
WHERE NOT EXISTS (
  SELECT 1 FROM `payment_method_configs` pm
  WHERE pm.`organization_id` = o.`id` AND pm.`code` = 'CASH'
);

INSERT INTO `payment_method_configs`
  (`id`,`organization_id`,`code`,`name_en`,`name_ar`,`base_method`,`is_settlement`,`requires_reference`,`sort_order`,`status`,`created_at`,`updated_at`)
SELECT UUID(), o.`id`, 'CARD', 'Card', 'بطاقة', 'CARD', TRUE, FALSE, 20, 'ACTIVE', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
FROM `organizations` o
WHERE NOT EXISTS (
  SELECT 1 FROM `payment_method_configs` pm
  WHERE pm.`organization_id` = o.`id` AND pm.`code` = 'CARD'
);

INSERT INTO `payment_method_configs`
  (`id`,`organization_id`,`code`,`name_en`,`name_ar`,`base_method`,`is_settlement`,`requires_reference`,`sort_order`,`status`,`created_at`,`updated_at`)
SELECT UUID(), o.`id`, 'BANK_TRANSFER', 'Bank transfer', 'تحويل بنكي', 'BANK_TRANSFER', TRUE, FALSE, 30, 'ACTIVE', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
FROM `organizations` o
WHERE NOT EXISTS (
  SELECT 1 FROM `payment_method_configs` pm
  WHERE pm.`organization_id` = o.`id` AND pm.`code` = 'BANK_TRANSFER'
);

INSERT INTO `payment_method_configs`
  (`id`,`organization_id`,`code`,`name_en`,`name_ar`,`base_method`,`is_settlement`,`requires_reference`,`sort_order`,`status`,`created_at`,`updated_at`)
SELECT UUID(), o.`id`, 'ONLINE', 'Online', 'إلكتروني', 'ONLINE', TRUE, FALSE, 40, 'ACTIVE', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
FROM `organizations` o
WHERE NOT EXISTS (
  SELECT 1 FROM `payment_method_configs` pm
  WHERE pm.`organization_id` = o.`id` AND pm.`code` = 'ONLINE'
);

INSERT INTO `payment_method_configs`
  (`id`,`organization_id`,`code`,`name_en`,`name_ar`,`base_method`,`is_settlement`,`requires_reference`,`sort_order`,`status`,`created_at`,`updated_at`)
SELECT UUID(), o.`id`, 'CREDIT_ACCOUNT', 'Credit account', 'حساب آجل', 'CREDIT_ACCOUNT', FALSE, FALSE, 50, 'ACTIVE', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
FROM `organizations` o
WHERE NOT EXISTS (
  SELECT 1 FROM `payment_method_configs` pm
  WHERE pm.`organization_id` = o.`id` AND pm.`code` = 'CREDIT_ACCOUNT'
);

INSERT INTO `payment_method_configs`
  (`id`,`organization_id`,`code`,`name_en`,`name_ar`,`base_method`,`is_settlement`,`requires_reference`,`sort_order`,`status`,`created_at`,`updated_at`)
SELECT UUID(), o.`id`, 'OTHER', 'Other', 'أخرى', 'OTHER', TRUE, FALSE, 90, 'ACTIVE', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
FROM `organizations` o
WHERE NOT EXISTS (
  SELECT 1 FROM `payment_method_configs` pm
  WHERE pm.`organization_id` = o.`id` AND pm.`code` = 'OTHER'
);

ALTER TABLE `payments`
  ADD COLUMN `payment_method_config_id` CHAR(36) NULL AFTER `method`,
  ADD COLUMN `payment_method_code_snapshot` VARCHAR(60) NULL AFTER `payment_method_config_id`,
  ADD COLUMN `payment_method_name_en_snapshot` VARCHAR(160) NULL AFTER `payment_method_code_snapshot`,
  ADD COLUMN `payment_method_name_ar_snapshot` VARCHAR(160) NULL AFTER `payment_method_name_en_snapshot`;

UPDATE `payments` p
JOIN `payment_method_configs` pm
  ON pm.`organization_id` = p.`organization_id`
 AND pm.`code` = CAST(p.`method` AS CHAR)
SET p.`payment_method_config_id` = pm.`id`,
    p.`payment_method_code_snapshot` = pm.`code`,
    p.`payment_method_name_en_snapshot` = pm.`name_en`,
    p.`payment_method_name_ar_snapshot` = pm.`name_ar`;

ALTER TABLE `payments`
  MODIFY COLUMN `payment_method_config_id` CHAR(36) NOT NULL,
  MODIFY COLUMN `payment_method_code_snapshot` VARCHAR(60) NOT NULL,
  MODIFY COLUMN `payment_method_name_en_snapshot` VARCHAR(160) NOT NULL,
  ADD INDEX `payments_method_config_received_idx`(`payment_method_config_id`,`received_at`),
  ADD CONSTRAINT `payments_payment_method_config_id_fkey`
    FOREIGN KEY (`payment_method_config_id`) REFERENCES `payment_method_configs`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `refunds`
  ADD COLUMN `payment_method_config_id` CHAR(36) NULL AFTER `method`,
  ADD COLUMN `payment_method_code_snapshot` VARCHAR(60) NULL AFTER `payment_method_config_id`,
  ADD COLUMN `payment_method_name_en_snapshot` VARCHAR(160) NULL AFTER `payment_method_code_snapshot`,
  ADD COLUMN `payment_method_name_ar_snapshot` VARCHAR(160) NULL AFTER `payment_method_name_en_snapshot`;

UPDATE `refunds` r
JOIN `payment_method_configs` pm
  ON pm.`organization_id` = r.`organization_id`
 AND pm.`code` = CAST(r.`method` AS CHAR)
SET r.`payment_method_config_id` = pm.`id`,
    r.`payment_method_code_snapshot` = pm.`code`,
    r.`payment_method_name_en_snapshot` = pm.`name_en`,
    r.`payment_method_name_ar_snapshot` = pm.`name_ar`;

ALTER TABLE `refunds`
  MODIFY COLUMN `payment_method_config_id` CHAR(36) NOT NULL,
  MODIFY COLUMN `payment_method_code_snapshot` VARCHAR(60) NOT NULL,
  MODIFY COLUMN `payment_method_name_en_snapshot` VARCHAR(160) NOT NULL,
  ADD INDEX `refunds_method_config_processed_idx`(`payment_method_config_id`,`processed_at`),
  ADD CONSTRAINT `refunds_payment_method_config_id_fkey`
    FOREIGN KEY (`payment_method_config_id`) REFERENCES `payment_method_configs`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT IGNORE INTO `permissions` (`id`,`code`,`module`,`description`,`created_at`)
VALUES (UUID(),'billing.payment_methods.manage','billing','Manage configurable payment methods',CURRENT_TIMESTAMP(3));

INSERT IGNORE INTO `role_permissions` (`role_id`,`permission_id`,`granted_at`)
SELECT r.`id`, p.`id`, CURRENT_TIMESTAMP(3)
FROM `roles` r
JOIN `permissions` p ON p.`code` = 'billing.payment_methods.manage'
WHERE r.`code` = 'SYSTEM_ADMIN';
