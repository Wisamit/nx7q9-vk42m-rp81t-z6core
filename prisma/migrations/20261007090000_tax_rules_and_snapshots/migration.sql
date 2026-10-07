-- Phase 4H: append-only, effective-dated service-level tax configuration.
-- New rules are opt-in; existing invoices stay unchanged.
ALTER TABLE `branches`
  ADD COLUMN `tax_config_version` INT NOT NULL DEFAULT 0;

CREATE TABLE `tax_rules` (
  `id` CHAR(36) NOT NULL,
  `organization_id` CHAR(36) NOT NULL,
  `branch_id` CHAR(36) NULL,
  `test_id` CHAR(36) NULL,
  `package_id` CHAR(36) NULL,
  `scope_key` VARCHAR(160) NOT NULL,
  `code` VARCHAR(60) NOT NULL,
  `name_en` VARCHAR(200) NOT NULL,
  `name_ar` VARCHAR(200) NULL,
  `treatment` ENUM('STANDARD','ZERO_RATED','EXEMPT') NOT NULL,
  `price_mode` ENUM('EXCLUSIVE','INCLUSIVE') NOT NULL,
  `rate_percent` DECIMAL(5,2) NOT NULL,
  `effective_from` DATE NOT NULL,
  `reason` VARCHAR(1000) NOT NULL,
  `created_by_user_id` CHAR(36) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `tax_rules_org_scope_effective_key` (`organization_id`,`scope_key`,`effective_from`),
  INDEX `tax_rules_org_branch_effective_idx` (`organization_id`,`branch_id`,`effective_from`),
  INDEX `tax_rules_test_effective_idx` (`test_id`,`effective_from`),
  INDEX `tax_rules_package_effective_idx` (`package_id`,`effective_from`),
  CONSTRAINT `tax_rules_org_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `tax_rules_branch_fkey` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `tax_rules_test_fkey` FOREIGN KEY (`test_id`) REFERENCES `lab_tests`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `tax_rules_package_fkey` FOREIGN KEY (`package_id`) REFERENCES `commercial_packages`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `tax_rules_creator_fkey` FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `tax_rules_exactly_one_service` CHECK ((`test_id` IS NULL) <> (`package_id` IS NULL)),
  CONSTRAINT `tax_rules_rate_range` CHECK (`rate_percent` >= 0 AND `rate_percent` <= 100)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `discount_approval_requests`
  ADD COLUMN `tax_total_snapshot` DECIMAL(18,4) NOT NULL DEFAULT 0 AFTER `discount_total_snapshot`;

ALTER TABLE `invoices`
  ADD COLUMN `tax_breakdown_snapshot` JSON NULL AFTER `tax_total`;

ALTER TABLE `invoice_lines`
  ADD COLUMN `tax_rule_id` CHAR(36) NULL AFTER `tax_amount`,
  ADD COLUMN `tax_code_snapshot` VARCHAR(60) NULL AFTER `tax_rule_id`,
  ADD COLUMN `tax_rate_snapshot` DECIMAL(5,2) NULL AFTER `tax_code_snapshot`,
  ADD COLUMN `tax_treatment_snapshot` ENUM('STANDARD','ZERO_RATED','EXEMPT') NULL AFTER `tax_rate_snapshot`,
  ADD COLUMN `tax_price_mode_snapshot` ENUM('EXCLUSIVE','INCLUSIVE') NULL AFTER `tax_treatment_snapshot`,
  ADD INDEX `invoice_lines_tax_rule_idx` (`tax_rule_id`),
  ADD CONSTRAINT `invoice_lines_tax_rule_fkey` FOREIGN KEY (`tax_rule_id`) REFERENCES `tax_rules`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `credit_notes`
  ADD COLUMN `tax_total_snapshot` DECIMAL(18,4) NOT NULL DEFAULT 0 AFTER `invoice_total_snapshot`;

ALTER TABLE `credit_note_lines`
  ADD COLUMN `tax_amount_snapshot` DECIMAL(18,4) NOT NULL DEFAULT 0 AFTER `amount`;

INSERT IGNORE INTO `permissions` (`id`,`code`,`module`,`description`,`created_at`)
VALUES (UUID(),'billing.tax.manage','billing','Manage immutable effective-dated service tax rules',CURRENT_TIMESTAMP(3));

INSERT IGNORE INTO `role_permissions` (`role_id`,`permission_id`,`granted_at`)
SELECT r.id,p.id,CURRENT_TIMESTAMP(3)
FROM `roles` r JOIN `permissions` p ON p.code='billing.tax.manage'
WHERE r.code='SYSTEM_ADMIN';
