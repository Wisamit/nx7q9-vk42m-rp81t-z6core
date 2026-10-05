CREATE TABLE `specimens` (
  `id` CHAR(36) NOT NULL,
  `organization_id` CHAR(36) NOT NULL,
  `order_id` CHAR(36) NOT NULL,
  `parent_specimen_id` CHAR(36) NULL,
  `specimen_type_id` CHAR(36) NULL,
  `container_id` CHAR(36) NULL,
  `barcode` VARCHAR(80) NOT NULL,
  `sequence_number` INT NOT NULL,
  `status` ENUM('PLANNED','COLLECTED','RECEIVED','IN_TRANSIT','IN_PROCESS','REJECTED','DISPOSED') NOT NULL DEFAULT 'PLANNED',
  `collection_branch_id` CHAR(36) NULL,
  `current_branch_id` CHAR(36) NULL,
  `collected_by_user_id` CHAR(36) NULL,
  `collected_at` DATETIME(3) NULL,
  `received_by_user_id` CHAR(36) NULL,
  `received_at` DATETIME(3) NULL,
  `rejected_by_user_id` CHAR(36) NULL,
  `rejected_at` DATETIME(3) NULL,
  `rejection_reason_code` VARCHAR(80) NULL,
  `rejection_reason_text` VARCHAR(500) NULL,
  `volume` DECIMAL(10,3) NULL,
  `volume_unit` VARCHAR(30) NULL,
  `notes` TEXT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `specimens_org_barcode_key`(`organization_id`,`barcode`),
  UNIQUE INDEX `specimens_order_sequence_key`(`order_id`,`sequence_number`),
  INDEX `specimens_order_status_idx`(`order_id`,`status`),
  INDEX `specimens_current_branch_status_idx`(`current_branch_id`,`status`),
  INDEX `specimens_collection_branch_collected_idx`(`collection_branch_id`,`collected_at`),
  INDEX `specimens_type_status_idx`(`specimen_type_id`,`status`),
  CONSTRAINT `specimens_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `specimens_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `specimens_parent_specimen_id_fkey` FOREIGN KEY (`parent_specimen_id`) REFERENCES `specimens`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `specimens_specimen_type_id_fkey` FOREIGN KEY (`specimen_type_id`) REFERENCES `specimen_types`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `specimens_container_id_fkey` FOREIGN KEY (`container_id`) REFERENCES `containers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `specimens_collection_branch_id_fkey` FOREIGN KEY (`collection_branch_id`) REFERENCES `branches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `specimens_current_branch_id_fkey` FOREIGN KEY (`current_branch_id`) REFERENCES `branches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `specimens_collected_by_user_id_fkey` FOREIGN KEY (`collected_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `specimens_received_by_user_id_fkey` FOREIGN KEY (`received_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `specimens_rejected_by_user_id_fkey` FOREIGN KEY (`rejected_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `specimen_order_items` (
  `specimen_id` CHAR(36) NOT NULL,
  `order_item_id` CHAR(36) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`specimen_id`,`order_item_id`),
  INDEX `specimen_order_items_order_item_id_idx`(`order_item_id`),
  CONSTRAINT `specimen_order_items_specimen_id_fkey` FOREIGN KEY (`specimen_id`) REFERENCES `specimens`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `specimen_order_items_order_item_id_fkey` FOREIGN KEY (`order_item_id`) REFERENCES `order_items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `specimen_events` (
  `id` CHAR(36) NOT NULL,
  `specimen_id` CHAR(36) NOT NULL,
  `event_type` ENUM('CREATED','COLLECTED','RECEIVED','REJECTED','RELOCATED','TRANSFERRED','PROCESSING_STARTED','DISPOSED') NOT NULL,
  `branch_id` CHAR(36) NULL,
  `actor_user_id` CHAR(36) NULL,
  `from_status` ENUM('PLANNED','COLLECTED','RECEIVED','IN_TRANSIT','IN_PROCESS','REJECTED','DISPOSED') NULL,
  `to_status` ENUM('PLANNED','COLLECTED','RECEIVED','IN_TRANSIT','IN_PROCESS','REJECTED','DISPOSED') NULL,
  `details` JSON NULL,
  `occurred_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `specimen_events_specimen_occurred_idx`(`specimen_id`,`occurred_at`),
  INDEX `specimen_events_branch_occurred_idx`(`branch_id`,`occurred_at`),
  CONSTRAINT `specimen_events_specimen_id_fkey` FOREIGN KEY (`specimen_id`) REFERENCES `specimens`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `specimen_events_branch_id_fkey` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `specimen_events_actor_user_id_fkey` FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT IGNORE INTO `permissions` (`id`,`code`,`module`,`description`,`created_at`) VALUES
(UUID(),'specimens.view','specimens','View specimen and barcode traceability',CURRENT_TIMESTAMP(3)),
(UUID(),'specimens.collect','specimens','Collect and label specimens',CURRENT_TIMESTAMP(3)),
(UUID(),'specimens.receive','specimens','Receive specimens into laboratory custody',CURRENT_TIMESTAMP(3)),
(UUID(),'specimens.reject','specimens','Reject unsuitable specimens with reason',CURRENT_TIMESTAMP(3));

INSERT IGNORE INTO `role_permissions` (`role_id`,`permission_id`,`granted_at`)
SELECT r.id, p.id, CURRENT_TIMESTAMP(3)
FROM `roles` r
JOIN `permissions` p ON p.code IN ('specimens.view','specimens.collect','specimens.receive','specimens.reject')
WHERE r.code='SYSTEM_ADMIN';
