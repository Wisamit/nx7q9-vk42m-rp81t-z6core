-- Optional legacy staging rows retain NULL to preserve historical review provenance.
-- Non-null request keys protect new staging submissions inside organization locks.
ALTER TABLE `catalog_import_batches`
  ADD COLUMN `submission_key` CHAR(36) NULL;
CREATE UNIQUE INDEX `catalog_staging_actor_request_uq`
  ON `catalog_import_batches`(`organization_id`,`created_by_user_id`,`source_type`,`submission_key`);
