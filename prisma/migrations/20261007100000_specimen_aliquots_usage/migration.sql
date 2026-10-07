-- Phase 5C: derived aliquot traceability, available-volume accounting and specimen usage history.
-- Historical specimens deliberately keep remaining_volume NULL because pre-5C consumption cannot be inferred safely.
ALTER TABLE `specimens`
  ADD COLUMN `parent_relation_type` ENUM('RECOLLECTION','ALIQUOT') NULL AFTER `parent_specimen_id`,
  ADD COLUMN `remaining_volume` DECIMAL(10,3) NULL AFTER `volume_unit`,
  ADD COLUMN `remaining_volume_unit` VARCHAR(30) NULL AFTER `remaining_volume`,
  ADD COLUMN `storage_location` VARCHAR(200) NULL AFTER `remaining_volume_unit`;

-- Before Phase 5C parent_specimen_id was used only for recollection lineage.
UPDATE `specimens`
SET `parent_relation_type` = 'RECOLLECTION'
WHERE `parent_specimen_id` IS NOT NULL;

ALTER TABLE `specimen_events`
  MODIFY COLUMN `event_type`
    ENUM('CREATED','COLLECTED','RECEIVED','REJECTED','RELOCATED','TRANSFERRED','PROCESSING_STARTED','ALIQUOT_CREATED','VOLUME_RECONCILED','USED','DISPOSED')
    NOT NULL;

CREATE TABLE `specimen_usage_events` (
  `id` CHAR(36) NOT NULL,
  `organization_id` CHAR(36) NOT NULL,
  `specimen_id` CHAR(36) NOT NULL,
  `child_specimen_id` CHAR(36) NULL,
  `order_item_id` CHAR(36) NULL,
  `branch_id` CHAR(36) NOT NULL,
  `usage_type` ENUM('ALIQUOT','TESTING','REPEAT_TESTING','SEND_OUT','OTHER') NOT NULL,
  `volume_used` DECIMAL(10,3) NOT NULL,
  `volume_unit` VARCHAR(30) NOT NULL,
  `notes` VARCHAR(1000) NULL,
  `used_by_user_id` CHAR(36) NOT NULL,
  `used_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `specimen_usage_events_child_specimen_id_key` (`child_specimen_id`),
  INDEX `specimen_usage_events_org_used_idx` (`organization_id`, `used_at`),
  INDEX `specimen_usage_events_specimen_used_idx` (`specimen_id`, `used_at`),
  INDEX `specimen_usage_events_order_item_used_idx` (`order_item_id`, `used_at`),
  INDEX `specimen_usage_events_branch_used_idx` (`branch_id`, `used_at`),
  CONSTRAINT `specimen_usage_events_org_fkey`
    FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `specimen_usage_events_specimen_fkey`
    FOREIGN KEY (`specimen_id`) REFERENCES `specimens`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `specimen_usage_events_child_specimen_fkey`
    FOREIGN KEY (`child_specimen_id`) REFERENCES `specimens`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `specimen_usage_events_order_item_fkey`
    FOREIGN KEY (`order_item_id`) REFERENCES `order_items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `specimen_usage_events_branch_fkey`
    FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `specimen_usage_events_actor_fkey`
    FOREIGN KEY (`used_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT IGNORE INTO `permissions` (`id`,`code`,`module`,`description`,`created_at`)
VALUES (UUID(),'specimens.aliquot','specimens','Create aliquots, reconcile available volume and record specimen usage',CURRENT_TIMESTAMP(3));

INSERT IGNORE INTO `role_permissions` (`role_id`,`permission_id`,`granted_at`)
SELECT r.id,p.id,CURRENT_TIMESTAMP(3)
FROM `roles` r
JOIN `permissions` p ON p.code='specimens.aliquot'
WHERE r.code='SYSTEM_ADMIN';
