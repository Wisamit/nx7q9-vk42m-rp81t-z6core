ALTER TABLE `specimens`
  ADD COLUMN `kind` ENUM('PRIMARY','RECOLLECTION','ALIQUOT') NOT NULL DEFAULT 'PRIMARY' AFTER `sequence_number`,
  ADD COLUMN `storage_location` VARCHAR(255) NULL AFTER `volume_unit`;

UPDATE `specimens`
SET `kind` = 'RECOLLECTION'
WHERE `parent_specimen_id` IS NOT NULL;

ALTER TABLE `specimen_events`
  MODIFY COLUMN `event_type` ENUM(
    'CREATED','COLLECTED','RECEIVED','REJECTED','RELOCATED','TRANSFERRED',
    'PROCESSING_STARTED','ALIQUOT_CREATED','USAGE_RECORDED','DISPOSED'
  ) NOT NULL;

CREATE TABLE `specimen_usage_events` (
  `id` CHAR(36) NOT NULL,
  `organization_id` CHAR(36) NOT NULL,
  `specimen_id` CHAR(36) NOT NULL,
  `branch_id` CHAR(36) NOT NULL,
  `order_item_id` CHAR(36) NULL,
  `used_by_user_id` CHAR(36) NOT NULL,
  `usage_type` ENUM('TESTING','SEND_OUT','RETENTION','TRANSFER','OTHER') NOT NULL,
  `volume_used` DECIMAL(10,3) NULL,
  `volume_unit` VARCHAR(30) NULL,
  `purpose` VARCHAR(500) NULL,
  `used_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `specimen_usage_events_specimen_time_idx`(`specimen_id`, `used_at`),
  INDEX `specimen_usage_events_branch_time_idx`(`branch_id`, `used_at`),
  INDEX `specimen_usage_events_order_item_time_idx`(`order_item_id`, `used_at`),
  PRIMARY KEY (`id`),
  CONSTRAINT `specimen_usage_events_org_fk` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `specimen_usage_events_specimen_fk` FOREIGN KEY (`specimen_id`) REFERENCES `specimens`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `specimen_usage_events_branch_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `specimen_usage_events_order_item_fk` FOREIGN KEY (`order_item_id`) REFERENCES `order_items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `specimen_usage_events_user_fk` FOREIGN KEY (`used_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT IGNORE INTO `permissions` (`id`,`code`,`module`,`description`,`created_at`) VALUES
(UUID(),'specimens.aliquot','specimens','Create and manage specimen aliquots',CURRENT_TIMESTAMP(3)),
(UUID(),'specimens.use','specimens','Record specimen and aliquot usage',CURRENT_TIMESTAMP(3));

INSERT IGNORE INTO `role_permissions` (`role_id`,`permission_id`,`granted_at`)
SELECT r.id, p.id, CURRENT_TIMESTAMP(3)
FROM `roles` r
JOIN `permissions` p ON p.code IN ('specimens.aliquot','specimens.use')
WHERE r.code='SYSTEM_ADMIN';
