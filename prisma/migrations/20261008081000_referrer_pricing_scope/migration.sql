ALTER TABLE `price_lists`
  MODIFY COLUMN `scope_type` ENUM('ORGANIZATION','BRANCH','SOURCE','REFERRER','CLIENT','CONTRACT') NOT NULL DEFAULT 'ORGANIZATION',
  ADD COLUMN `referrer_id` CHAR(36) NULL AFTER `source_id`,
  ADD INDEX `price_lists_referrer_status_idx`(`referrer_id`, `status`),
  ADD CONSTRAINT `price_lists_referrer_id_fkey`
    FOREIGN KEY (`referrer_id`) REFERENCES `referrers`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;
