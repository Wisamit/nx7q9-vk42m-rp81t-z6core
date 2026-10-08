-- Preserve unmatched legacy storage text; never infer historical location identity.
ALTER TABLE `specimens`
  ADD COLUMN `storage_location_id` CHAR(36) NULL,
  ADD INDEX `specimens_storage_location_id_current_branch_id_idx` (`storage_location_id`, `current_branch_id`),
  ADD CONSTRAINT `specimens_storage_location_id_fkey`
    FOREIGN KEY (`storage_location_id`) REFERENCES `specimen_storage_locations`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;
