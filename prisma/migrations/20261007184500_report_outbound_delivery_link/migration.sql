ALTER TABLE `notification_deliveries`
  ADD COLUMN `report_delivery_event_id` CHAR(36) NULL AFTER `notification_id`,
  ADD UNIQUE INDEX `notification_deliveries_report_delivery_event_id_key`(`report_delivery_event_id`),
  ADD CONSTRAINT `notification_deliveries_report_delivery_event_id_fkey`
    FOREIGN KEY (`report_delivery_event_id`) REFERENCES `report_delivery_events`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;
