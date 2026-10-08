ALTER TABLE `patients`
  ADD COLUMN `whatsapp` VARCHAR(50) NULL AFTER `normalized_phone`,
  ADD COLUMN `address_en` TEXT NULL AFTER `nationality_code`,
  ADD COLUMN `address_ar` TEXT NULL AFTER `address_en`,
  ADD COLUMN `notes` TEXT NULL AFTER `address_ar`,
  ADD COLUMN `clinical_information` TEXT NULL AFTER `notes`,
  ADD COLUMN `creation_branch_id` CHAR(36) NULL AFTER `clinical_information`,
  ADD INDEX `patients_creation_branch_created_idx`(`creation_branch_id`, `created_at`),
  ADD CONSTRAINT `patients_creation_branch_fkey`
    FOREIGN KEY (`creation_branch_id`) REFERENCES `branches`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;
