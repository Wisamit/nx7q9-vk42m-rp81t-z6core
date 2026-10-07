-- Phase 4G: currency-isolated client credit policies with a client-wide
-- optimistic lock. No active policy is created for existing clients.
ALTER TABLE `clients`
  ADD COLUMN `credit_control_version` INT NOT NULL DEFAULT 0 AFTER `payment_terms_days`;

ALTER TABLE `invoices`
  ADD COLUMN `credit_control_snapshot` JSON NULL AFTER `balance_amount`;

CREATE TABLE `client_credit_policies` (
  `id` CHAR(36) NOT NULL,
  `organization_id` CHAR(36) NOT NULL,
  `client_id` CHAR(36) NOT NULL,
  `currency` CHAR(3) NOT NULL,
  `mode` ENUM('DISABLED','WARN','BLOCK') NOT NULL DEFAULT 'DISABLED',
  `limit_amount` DECIMAL(18,4) NOT NULL DEFAULT 0,
  `reason` VARCHAR(1000) NULL,
  `created_by_user_id` CHAR(36) NOT NULL,
  `updated_by_user_id` CHAR(36) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `client_credit_policies_org_client_currency_key` (`organization_id`, `client_id`, `currency`),
  INDEX `client_credit_policies_org_currency_mode_idx` (`organization_id`, `currency`, `mode`),
  CONSTRAINT `client_credit_policies_org_fkey`
    FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `client_credit_policies_client_fkey`
    FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `client_credit_policies_creator_fkey`
    FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `client_credit_policies_updater_fkey`
    FOREIGN KEY (`updated_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT IGNORE INTO `permissions` (`id`,`code`,`module`,`description`,`created_at`)
VALUES (UUID(),'billing.credit.limits.manage','billing','Manage organization-wide client credit limits',CURRENT_TIMESTAMP(3));

INSERT IGNORE INTO `role_permissions` (`role_id`,`permission_id`,`granted_at`)
SELECT r.id,p.id,CURRENT_TIMESTAMP(3)
FROM `roles` r
JOIN `permissions` p ON p.code='billing.credit.limits.manage'
WHERE r.code='SYSTEM_ADMIN';
