-- Add source/campaign scoped pricing without changing historical price snapshots.
ALTER TABLE `price_lists`
  MODIFY `scope_type` ENUM('ORGANIZATION','BRANCH','SOURCE','CLIENT','CONTRACT') NOT NULL DEFAULT 'ORGANIZATION',
  ADD COLUMN `source_id` CHAR(36) NULL AFTER `branch_id`;

CREATE INDEX `price_lists_source_status_idx` ON `price_lists`(`source_id`, `status`);

ALTER TABLE `price_lists`
  ADD CONSTRAINT `price_lists_source_id_fkey`
  FOREIGN KEY (`source_id`) REFERENCES `order_sources`(`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE;
