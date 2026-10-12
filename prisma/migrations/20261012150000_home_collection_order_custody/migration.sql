-- Stage 90: append-only home collection order association and specimen provenance.
-- Nullable additions are safe for historical appointments/collections; no result,
-- invoice, accession, patient identity or previous clinical narrative is rewritten.
ALTER TABLE `home_collection_visits`
  ADD COLUMN `order_id` CHAR(36) NULL AFTER `appointment_id`,
  ADD COLUMN `order_linked_by_user_id` CHAR(36) NULL AFTER `order_id`,
  ADD COLUMN `order_linked_at` DATETIME(3) NULL AFTER `order_linked_by_user_id`,
  ADD UNIQUE INDEX `home_collection_visits_order_id_key` (`order_id`),
  ADD CONSTRAINT `home_collection_visits_order_id_fkey`
    FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `home_collection_visits_order_linked_by_user_id_fkey`
    FOREIGN KEY (`order_linked_by_user_id`) REFERENCES `users`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `specimen_collection_attempts`
  ADD COLUMN `home_collection_visit_id` CHAR(36) NULL AFTER `specimen_id`,
  ADD INDEX `home_attempt_visit_time_idx`
    (`home_collection_visit_id`,`attempted_at`),
  ADD CONSTRAINT `specimen_collection_attempts_home_collection_visit_id_fkey`
    FOREIGN KEY (`home_collection_visit_id`) REFERENCES `home_collection_visits`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;
