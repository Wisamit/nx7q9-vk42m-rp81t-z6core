-- Nullable unique idempotency token; legacy delivery events are unaffected.
ALTER TABLE `report_delivery_events`
  ADD COLUMN `handover_request_id` CHAR(36) NULL;
CREATE UNIQUE INDEX `report_delivery_events_handover_request_id_key`
  ON `report_delivery_events`(`handover_request_id`);
