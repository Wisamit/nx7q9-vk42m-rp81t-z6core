CREATE TABLE `result_repeat_events` (
  `id` CHAR(36) NOT NULL,
  `organization_id` CHAR(36) NOT NULL,
  `order_item_id` CHAR(36) NOT NULL,
  `result_id` CHAR(36) NULL,
  `specimen_id` CHAR(36) NULL,
  `type` ENUM('RERUN','REPEAT') NOT NULL,
  `reason` VARCHAR(1000) NOT NULL,
  `requested_by_user_id` CHAR(36) NOT NULL,
  `requested_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `repeat_event_order_item_idx`(`order_item_id`, `requested_at`),
  INDEX `repeat_event_result_idx`(`result_id`, `requested_at`),
  INDEX `repeat_event_specimen_idx`(`specimen_id`, `requested_at`),
  PRIMARY KEY (`id`),
  CONSTRAINT `repeat_event_org_fk`
    FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `repeat_event_order_item_fk`
    FOREIGN KEY (`order_item_id`) REFERENCES `order_items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `repeat_event_result_fk`
    FOREIGN KEY (`result_id`) REFERENCES `laboratory_results`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `repeat_event_specimen_fk`
    FOREIGN KEY (`specimen_id`) REFERENCES `specimens`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `repeat_event_user_fk`
    FOREIGN KEY (`requested_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
