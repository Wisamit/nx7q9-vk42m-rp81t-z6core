-- Phase 5D: immutable reception quality assessments and configurable selective specimen rejection.

ALTER TABLE `specimens`
  ADD COLUMN `preanalytical_version` INT NOT NULL DEFAULT 0 AFTER `storage_location`;

ALTER TABLE `specimen_order_items`
  ADD COLUMN `status` ENUM('ACTIVE','REJECTED') NOT NULL DEFAULT 'ACTIVE' AFTER `order_item_id`,
  ADD COLUMN `rejection_id` CHAR(36) NULL AFTER `status`;

DROP INDEX `specimen_order_items_order_item_id_idx` ON `specimen_order_items`;
CREATE INDEX `specimen_order_items_order_item_status_idx`
  ON `specimen_order_items` (`order_item_id`, `status`);
CREATE INDEX `specimen_order_items_rejection_id_idx`
  ON `specimen_order_items` (`rejection_id`);

CREATE TABLE `specimen_reception_assessments` (
  `id` CHAR(36) NOT NULL,
  `organization_id` CHAR(36) NOT NULL,
  `specimen_id` CHAR(36) NOT NULL,
  `branch_id` CHAR(36) NOT NULL,
  `received_by_user_id` CHAR(36) NOT NULL,
  `barcode_snapshot` VARCHAR(80) NOT NULL,
  `expected_container_code_snapshot` VARCHAR(50) NULL,
  `observed_container_code` VARCHAR(80) NULL,
  `label_assessment` ENUM('MATCHED','UNLABELED','MISMATCHED') NOT NULL,
  `condition_code` VARCHAR(80) NOT NULL,
  `temperature_c` DECIMAL(6,2) NULL,
  `discrepancy_text` VARCHAR(1000) NULL,
  `notes` VARCHAR(1000) NULL,
  `received_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `specimen_reception_specimen_received_idx` (`specimen_id`, `received_at`),
  INDEX `specimen_reception_branch_received_idx` (`branch_id`, `received_at`),
  CONSTRAINT `specimen_reception_org_fkey`
    FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `specimen_reception_specimen_fkey`
    FOREIGN KEY (`specimen_id`) REFERENCES `specimens`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `specimen_reception_branch_fkey`
    FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `specimen_reception_actor_fkey`
    FOREIGN KEY (`received_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `specimen_rejection_reasons` (
  `id` CHAR(36) NOT NULL,
  `organization_id` CHAR(36) NOT NULL,
  `code` VARCHAR(80) NOT NULL,
  `name_en` VARCHAR(180) NOT NULL,
  `name_ar` VARCHAR(180) NULL,
  `sort_order` INT NOT NULL DEFAULT 0,
  `status` ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  `deactivated_at` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `specimen_rejection_reasons_org_code_key` (`organization_id`, `code`),
  INDEX `specimen_rejection_reasons_org_status_sort_idx` (`organization_id`, `status`, `sort_order`),
  CONSTRAINT `specimen_rejection_reasons_org_fkey`
    FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `specimen_rejections` (
  `id` CHAR(36) NOT NULL,
  `organization_id` CHAR(36) NOT NULL,
  `specimen_id` CHAR(36) NOT NULL,
  `branch_id` CHAR(36) NOT NULL,
  `rejected_by_user_id` CHAR(36) NOT NULL,
  `reason_id` CHAR(36) NULL,
  `reason_code_snapshot` VARCHAR(80) NOT NULL,
  `reason_name_en_snapshot` VARCHAR(180) NOT NULL,
  `reason_name_ar_snapshot` VARCHAR(180) NULL,
  `reason_details` VARCHAR(1000) NOT NULL,
  `scope` ENUM('WHOLE_SPECIMEN','SELECTED_TESTS') NOT NULL,
  `replacement_specimen_id` CHAR(36) NULL,
  `rejected_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `specimen_rejections_specimen_rejected_idx` (`specimen_id`, `rejected_at`),
  INDEX `specimen_rejections_branch_rejected_idx` (`branch_id`, `rejected_at`),
  INDEX `specimen_rejections_reason_rejected_idx` (`reason_id`, `rejected_at`),
  INDEX `specimen_rejections_replacement_idx` (`replacement_specimen_id`),
  CONSTRAINT `specimen_rejections_org_fkey`
    FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `specimen_rejections_specimen_fkey`
    FOREIGN KEY (`specimen_id`) REFERENCES `specimens`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `specimen_rejections_branch_fkey`
    FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `specimen_rejections_actor_fkey`
    FOREIGN KEY (`rejected_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `specimen_rejections_reason_fkey`
    FOREIGN KEY (`reason_id`) REFERENCES `specimen_rejection_reasons`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `specimen_rejections_replacement_fkey`
    FOREIGN KEY (`replacement_specimen_id`) REFERENCES `specimens`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `specimen_order_items`
  ADD CONSTRAINT `specimen_order_items_rejection_fkey`
    FOREIGN KEY (`rejection_id`) REFERENCES `specimen_rejections`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- Seed the default configurable reasons required by the master scope for every existing organization.
INSERT IGNORE INTO `specimen_rejection_reasons`
(`id`,`organization_id`,`code`,`name_en`,`name_ar`,`sort_order`,`status`,`created_at`,`updated_at`)
SELECT UUID(), o.id, seed.code, seed.name_en, seed.name_ar, seed.sort_order, 'ACTIVE', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
FROM `organizations` o
CROSS JOIN (
  SELECT 'WRONG_TUBE' code, 'Wrong tube / container' name_en, 'أنبوب / حاوية غير صحيحة' name_ar, 10 sort_order
  UNION ALL SELECT 'INSUFFICIENT_VOLUME','Insufficient volume','حجم غير كافٍ',20
  UNION ALL SELECT 'CLOTTED','Clotted','متخثرة',30
  UNION ALL SELECT 'HEMOLYZED','Hemolyzed','انحلال دم',40
  UNION ALL SELECT 'LIPEMIC','Lipemic','دهنية',50
  UNION ALL SELECT 'ICTERIC','Icteric','يرقانية',60
  UNION ALL SELECT 'LEAKING','Leaking','تسرب',70
  UNION ALL SELECT 'UNLABELED','Unlabeled','بدون ملصق',80
  UNION ALL SELECT 'MISLABELED','Mislabeled','ملصق خاطئ',90
  UNION ALL SELECT 'TRANSPORT_DELAY','Transport delay','تأخر النقل',100
  UNION ALL SELECT 'TEMPERATURE_FAILURE','Temperature failure','فشل درجة الحرارة',110
  UNION ALL SELECT 'CONTAMINATION','Contamination','تلوث',120
  UNION ALL SELECT 'OTHER','Other','أخرى',999
) seed;

