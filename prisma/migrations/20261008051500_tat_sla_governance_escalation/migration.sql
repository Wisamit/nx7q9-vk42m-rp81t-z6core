ALTER TABLE `test_tat_policies`
  ADD COLUMN `escalation_after_minutes` INTEGER NULL AFTER `alert_before_minutes`,
  ADD COLUMN `escalation_repeat_minutes` INTEGER NULL AFTER `escalation_after_minutes`,
  ADD COLUMN `max_escalation_level` INTEGER NOT NULL DEFAULT 1 AFTER `escalation_repeat_minutes`,
  ADD COLUMN `escalation_permission_code` VARCHAR(120) NULL AFTER `max_escalation_level`,
  ADD COLUMN `approval_status` ENUM('DRAFT','APPROVED','RETIRED') NOT NULL DEFAULT 'DRAFT' AFTER `status`,
  ADD COLUMN `approved_by_user_id` CHAR(36) NULL AFTER `created_by_user_id`,
  ADD COLUMN `approved_at` DATETIME(3) NULL AFTER `approved_by_user_id`,
  ADD COLUMN `retired_by_user_id` CHAR(36) NULL AFTER `approved_at`,
  ADD COLUMN `retired_at` DATETIME(3) NULL AFTER `retired_by_user_id`,
  ADD COLUMN `retirement_reason` VARCHAR(1000) NULL AFTER `retired_at`;

UPDATE `test_tat_policies`
SET
  `approval_status` = CASE WHEN `status` = 'ACTIVE' THEN 'APPROVED' ELSE 'RETIRED' END,
  `approved_at` = CASE WHEN `status` = 'ACTIVE' THEN COALESCE(`updated_at`, `created_at`) ELSE NULL END,
  `retired_at` = CASE WHEN `status` = 'INACTIVE' THEN COALESCE(`updated_at`, `created_at`) ELSE NULL END;

ALTER TABLE `test_tat_policies`
  DROP INDEX `test_tat_policies_test_status_effective_idx`,
  DROP INDEX `test_tat_policies_branch_status_effective_idx`,
  DROP INDEX `test_tat_policies_scope_status_effective_idx`,
  MODIFY COLUMN `status` ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'INACTIVE',
  ADD CONSTRAINT `test_tat_policies_approved_by_fkey`
    FOREIGN KEY (`approved_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `test_tat_policies_retired_by_fkey`
    FOREIGN KEY (`retired_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD INDEX `test_tat_policies_test_status_approval_effective_idx`(`test_id`,`status`,`approval_status`,`effective_from`,`effective_to`),
  ADD INDEX `test_tat_policies_branch_status_approval_effective_idx`(`branch_id`,`status`,`approval_status`,`effective_from`,`effective_to`),
  ADD INDEX `test_tat_policies_scope_status_approval_effective_idx`(`test_id`,`branch_id`,`priority`,`status`,`approval_status`,`effective_from`),
  ADD INDEX `test_tat_policies_approved_by_approved_at_idx`(`approved_by_user_id`,`approved_at`);

ALTER TABLE `order_items`
  ADD COLUMN `tat_escalation_after_minutes_snapshot` INTEGER NULL AFTER `tat_alert_at`,
  ADD COLUMN `tat_escalation_repeat_minutes_snapshot` INTEGER NULL AFTER `tat_escalation_after_minutes_snapshot`,
  ADD COLUMN `tat_max_escalation_level_snapshot` INTEGER NULL AFTER `tat_escalation_repeat_minutes_snapshot`,
  ADD COLUMN `tat_escalation_permission_code_snapshot` VARCHAR(120) NULL AFTER `tat_max_escalation_level_snapshot`,
  ADD COLUMN `tat_first_escalation_at` DATETIME(3) NULL AFTER `tat_escalation_permission_code_snapshot`,
  ADD INDEX `order_items_tat_first_escalation_status_idx`(`tat_first_escalation_at`,`status`);

CREATE TABLE `tat_escalation_events` (
  `id` CHAR(36) NOT NULL,
  `organization_id` CHAR(36) NOT NULL,
  `branch_id` CHAR(36) NOT NULL,
  `order_item_id` CHAR(36) NOT NULL,
  `level` INTEGER NOT NULL,
  `status` ENUM('OPEN','ACKNOWLEDGED','CLOSED') NOT NULL DEFAULT 'OPEN',
  `tat_due_at_snapshot` DATETIME(3) NOT NULL,
  `escalation_due_at_snapshot` DATETIME(3) NOT NULL,
  `permission_code_snapshot` VARCHAR(120) NOT NULL,
  `recipient_count` INTEGER NOT NULL DEFAULT 0,
  `notification_ids_snapshot` JSON NULL,
  `acknowledged_by_user_id` CHAR(36) NULL,
  `acknowledged_at` DATETIME(3) NULL,
  `acknowledgement_note` VARCHAR(1000) NULL,
  `closed_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `tat_escalation_events_order_item_level_key`(`order_item_id`,`level`),
  INDEX `tat_escalation_events_org_status_due_idx`(`organization_id`,`status`,`escalation_due_at_snapshot`),
  INDEX `tat_escalation_events_branch_status_created_idx`(`branch_id`,`status`,`created_at`),
  INDEX `tat_escalation_events_ack_by_at_idx`(`acknowledged_by_user_id`,`acknowledged_at`),
  CONSTRAINT `tat_escalation_events_org_fkey`
    FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `tat_escalation_events_branch_fkey`
    FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `tat_escalation_events_order_item_fkey`
    FOREIGN KEY (`order_item_id`) REFERENCES `order_items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `tat_escalation_events_ack_by_fkey`
    FOREIGN KEY (`acknowledged_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT IGNORE INTO `permissions` (`id`,`code`,`module`,`description`,`created_at`) VALUES
(UUID(),'catalog.tat_policies.approve','catalog','Approve and retire TAT / SLA policies',CURRENT_TIMESTAMP(3)),
(UUID(),'worklists.tat_escalations.acknowledge','laboratory','Acknowledge TAT breach escalation events',CURRENT_TIMESTAMP(3));

INSERT IGNORE INTO `role_permissions` (`role_id`,`permission_id`,`granted_at`)
SELECT DISTINCT rp.role_id, target.id, CURRENT_TIMESTAMP(3)
FROM `role_permissions` rp
JOIN `permissions` source ON source.id = rp.permission_id AND source.code = 'catalog.manage'
JOIN `permissions` target ON target.code = 'catalog.tat_policies.approve';

INSERT IGNORE INTO `role_permissions` (`role_id`,`permission_id`,`granted_at`)
SELECT DISTINCT rp.role_id, target.id, CURRENT_TIMESTAMP(3)
FROM `role_permissions` rp
JOIN `permissions` source ON source.id = rp.permission_id AND source.code = 'results.verify'
JOIN `permissions` target ON target.code = 'worklists.tat_escalations.acknowledge';

INSERT IGNORE INTO `role_permissions` (`role_id`,`permission_id`,`granted_at`)
SELECT r.id, p.id, CURRENT_TIMESTAMP(3)
FROM `roles` r
JOIN `permissions` p ON p.code IN ('catalog.tat_policies.approve','worklists.tat_escalations.acknowledge')
WHERE r.code='SYSTEM_ADMIN';
