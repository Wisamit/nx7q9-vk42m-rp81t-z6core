-- Stage 97: additive, organization-wide stock lot safety decisions.
-- Existing inventory lots stay AVAILABLE; never rewrite stock or movement history.
ALTER TABLE `inventory_lots`
  ADD COLUMN `safety_status` ENUM('AVAILABLE','QUARANTINED','RECALLED')
  NOT NULL DEFAULT 'AVAILABLE';
CREATE TABLE `inventory_lot_safety_events` (
  `id` CHAR(36) NOT NULL,
  `organization_id` CHAR(36) NOT NULL,
  `lot_id` CHAR(36) NOT NULL,
  `actor_user_id` CHAR(36) NOT NULL,
  `branch_id` CHAR(36) NOT NULL,
  `prior_status` ENUM('AVAILABLE','QUARANTINED','RECALLED') NOT NULL,
  `next_status` ENUM('AVAILABLE','QUARANTINED','RECALLED') NOT NULL,
  `reason` VARCHAR(1000) NOT NULL,
  `affected_stocks` JSON NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY(`id`),
  INDEX `ilse_org_created_idx`(`organization_id`,`created_at`),
  INDEX `ilse_lot_created_idx`(`lot_id`,`created_at`),
  INDEX `ilse_actor_idx`(`actor_user_id`),
  INDEX `ilse_branch_idx`(`branch_id`),
  CONSTRAINT `ilse_lot_fk` FOREIGN KEY(`lot_id`) REFERENCES `inventory_lots`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `ilse_actor_fk` FOREIGN KEY(`actor_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `ilse_branch_fk` FOREIGN KEY(`branch_id`) REFERENCES `branches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `ilse_org_fk` FOREIGN KEY(`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
