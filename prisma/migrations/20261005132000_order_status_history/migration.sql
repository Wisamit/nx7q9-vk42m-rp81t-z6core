CREATE TABLE `order_status_history` (
  `id` CHAR(36) NOT NULL,
  `order_id` CHAR(36) NOT NULL,
  `from_status` ENUM('DRAFT','REGISTERED','COLLECTED','IN_PROGRESS','COMPLETED','CANCELLED') NULL,
  `to_status` ENUM('DRAFT','REGISTERED','COLLECTED','IN_PROGRESS','COMPLETED','CANCELLED') NOT NULL,
  `reason` VARCHAR(500) NULL,
  `changed_by_user_id` CHAR(36) NOT NULL,
  `changed_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `order_status_history_order_changed_at_idx`(`order_id`,`changed_at`),
  INDEX `order_status_history_user_changed_at_idx`(`changed_by_user_id`,`changed_at`),
  CONSTRAINT `order_status_history_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `order_status_history_changed_by_user_id_fkey` FOREIGN KEY (`changed_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
