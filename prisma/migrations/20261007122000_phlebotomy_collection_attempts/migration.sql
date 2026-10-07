-- Phase 5E: audited phlebotomy collection attempts, patient verification and failed-collection recollection.

ALTER TABLE `specimens`
  MODIFY COLUMN `status` ENUM(
    'PLANNED','COLLECTION_FAILED','COLLECTED','RECEIVED','IN_TRANSIT','IN_PROCESS','REJECTED','DISPOSED'
  ) NOT NULL DEFAULT 'PLANNED';

ALTER TABLE `specimen_events`
  MODIFY COLUMN `event_type` ENUM(
    'CREATED','COLLECTION_FAILED','COLLECTED','RECEIVED','REJECTED','RELOCATED','TRANSFERRED',
    'PROCESSING_STARTED','ALIQUOT_CREATED','VOLUME_RECONCILED','USED','DISPOSED'
  ) NOT NULL,
  MODIFY COLUMN `from_status` ENUM(
    'PLANNED','COLLECTION_FAILED','COLLECTED','RECEIVED','IN_TRANSIT','IN_PROCESS','REJECTED','DISPOSED'
  ) NULL,
  MODIFY COLUMN `to_status` ENUM(
    'PLANNED','COLLECTION_FAILED','COLLECTED','RECEIVED','IN_TRANSIT','IN_PROCESS','REJECTED','DISPOSED'
  ) NULL;

ALTER TABLE `specimen_order_items`
  MODIFY COLUMN `status` ENUM('ACTIVE','FAILED_COLLECTION','REJECTED') NOT NULL DEFAULT 'ACTIVE';

CREATE TABLE `specimen_collection_attempts` (
  `id` CHAR(36) NOT NULL,
  `organization_id` CHAR(36) NOT NULL,
  `specimen_id` CHAR(36) NOT NULL,
  `replacement_specimen_id` CHAR(36) NULL,
  `branch_id` CHAR(36) NOT NULL,
  `collector_user_id` CHAR(36) NOT NULL,
  `branch_code_snapshot` VARCHAR(50) NOT NULL,
  `branch_name_en_snapshot` VARCHAR(200) NOT NULL,
  `branch_name_ar_snapshot` VARCHAR(200) NULL,
  `collector_name_en_snapshot` VARCHAR(200) NOT NULL,
  `collector_name_ar_snapshot` VARCHAR(200) NULL,
  `outcome` ENUM('SUCCESS','FAILED') NOT NULL,
  `patient_name_snapshot` VARCHAR(220) NOT NULL,
  `patient_number_snapshot` VARCHAR(40) NOT NULL,
  `secondary_verification_type` ENUM('DATE_OF_BIRTH','PATIENT_NUMBER','PHONE','EXTERNAL_IDENTIFIER') NOT NULL,
  `secondary_verification_snapshot` VARCHAR(160) NOT NULL,
  `collection_location_type` ENUM('BRANCH','HOME','OTHER') NOT NULL,
  `collection_location_text` VARCHAR(250) NULL,
  `volume` DECIMAL(10,3) NULL,
  `volume_unit` VARCHAR(30) NULL,
  `failure_reason_code` VARCHAR(80) NULL,
  `failure_reason_text` VARCHAR(1000) NULL,
  `notes` VARCHAR(1000) NULL,
  `attempted_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `specimen_collection_attempts_replacement_key` (`replacement_specimen_id`),
  INDEX `specimen_collection_attempts_specimen_attempted_idx` (`specimen_id`, `attempted_at`),
  INDEX `specimen_collection_attempts_branch_attempted_idx` (`branch_id`, `attempted_at`),
  INDEX `specimen_collection_attempts_collector_attempted_idx` (`collector_user_id`, `attempted_at`),
  CONSTRAINT `specimen_collection_attempts_org_fkey`
    FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `specimen_collection_attempts_specimen_fkey`
    FOREIGN KEY (`specimen_id`) REFERENCES `specimens`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `specimen_collection_attempts_replacement_fkey`
    FOREIGN KEY (`replacement_specimen_id`) REFERENCES `specimens`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `specimen_collection_attempts_branch_fkey`
    FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `specimen_collection_attempts_collector_fkey`
    FOREIGN KEY (`collector_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
