CREATE TABLE `specimen_transfer_manifests` (
  `id` CHAR(36) NOT NULL,
  `organization_id` CHAR(36) NOT NULL,
  `manifest_number` VARCHAR(60) NOT NULL,
  `source_branch_id` CHAR(36) NOT NULL,
  `destination_branch_id` CHAR(36) NOT NULL,
  `status` ENUM('DRAFT','DISPATCHED','PARTIALLY_RECEIVED','RECEIVED','CANCELLED') NOT NULL DEFAULT 'DRAFT',
  `transport_mode` VARCHAR(80) NULL,
  `courier_name` VARCHAR(150) NULL,
  `package_count` INT NULL,
  `notes` TEXT NULL,
  `created_by_user_id` CHAR(36) NOT NULL,
  `dispatched_by_user_id` CHAR(36) NULL,
  `dispatched_at` DATETIME(3) NULL,
  `received_by_user_id` CHAR(36) NULL,
  `received_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `transfer_manifest_org_number_key`(`organization_id`,`manifest_number`),
  INDEX `transfer_manifest_source_status_idx`(`source_branch_id`,`status`,`created_at`),
  INDEX `transfer_manifest_destination_status_idx`(`destination_branch_id`,`status`,`created_at`),
  CONSTRAINT `transfer_manifest_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `transfer_manifest_source_branch_id_fkey` FOREIGN KEY (`source_branch_id`) REFERENCES `branches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `transfer_manifest_destination_branch_id_fkey` FOREIGN KEY (`destination_branch_id`) REFERENCES `branches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `transfer_manifest_created_by_user_id_fkey` FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `transfer_manifest_dispatched_by_user_id_fkey` FOREIGN KEY (`dispatched_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `transfer_manifest_received_by_user_id_fkey` FOREIGN KEY (`received_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `specimen_transfer_items` (
  `manifest_id` CHAR(36) NOT NULL,
  `specimen_id` CHAR(36) NOT NULL,
  `barcode_snapshot` VARCHAR(80) NOT NULL,
  `status` ENUM('PLANNED','DISPATCHED','RECEIVED','EXCEPTION') NOT NULL DEFAULT 'PLANNED',
  `received_by_user_id` CHAR(36) NULL,
  `received_at` DATETIME(3) NULL,
  `exception_text` VARCHAR(500) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`manifest_id`,`specimen_id`),
  INDEX `transfer_items_specimen_status_idx`(`specimen_id`,`status`),
  INDEX `transfer_items_receiver_received_at_idx`(`received_by_user_id`,`received_at`),
  CONSTRAINT `transfer_items_manifest_id_fkey` FOREIGN KEY (`manifest_id`) REFERENCES `specimen_transfer_manifests`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `transfer_items_specimen_id_fkey` FOREIGN KEY (`specimen_id`) REFERENCES `specimens`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `transfer_items_received_by_user_id_fkey` FOREIGN KEY (`received_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT IGNORE INTO `permissions` (`id`,`code`,`module`,`description`,`created_at`) VALUES
(UUID(),'transfers.view','specimens','View inter-branch specimen manifests',CURRENT_TIMESTAMP(3)),
(UUID(),'transfers.create','specimens','Create inter-branch specimen manifests',CURRENT_TIMESTAMP(3)),
(UUID(),'transfers.dispatch','specimens','Dispatch specimen manifests',CURRENT_TIMESTAMP(3)),
(UUID(),'transfers.receive','specimens','Receive specimen manifests and items',CURRENT_TIMESTAMP(3));

INSERT IGNORE INTO `role_permissions` (`role_id`,`permission_id`,`granted_at`)
SELECT r.id, p.id, CURRENT_TIMESTAMP(3)
FROM `roles` r
JOIN `permissions` p ON p.code IN ('transfers.view','transfers.create','transfers.dispatch','transfers.receive')
WHERE r.code='SYSTEM_ADMIN';
