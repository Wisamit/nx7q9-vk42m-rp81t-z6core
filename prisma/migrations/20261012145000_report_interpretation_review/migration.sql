-- Stage 89: append-only, independently approved bilingual interpretation
-- notes. No existing issued report, report snapshot, or result is modified.
CREATE TABLE `report_interpretive_comments` (
  `id` CHAR(36) NOT NULL,
  `organization_id` CHAR(36) NOT NULL,
  `order_id` CHAR(36) NOT NULL,
  `revision_number` INTEGER NOT NULL,
  `status` ENUM('DRAFT','APPROVED','REJECTED','RETIRED') NOT NULL DEFAULT 'DRAFT',
  `text_en` TEXT NOT NULL,
  `text_ar` TEXT NOT NULL,
  `supersedes_comment_id` CHAR(36) NULL,
  `created_by_user_id` CHAR(36) NOT NULL,
  `approved_by_user_id` CHAR(36) NULL,
  `review_reason` TEXT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `approved_at` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `report_interpretive_comments_order_id_revision_number_key` (`order_id`,`revision_number`),
  INDEX `report_interpretive_comments_organization_id_status_created_at_idx` (`organization_id`,`status`,`created_at`),
  INDEX `report_interpretive_comments_order_id_status_revision_number_idx` (`order_id`,`status`,`revision_number`),
  CONSTRAINT `report_interpretive_comments_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `report_interpretive_comments_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `report_interpretive_comments_supersedes_comment_id_fkey` FOREIGN KEY (`supersedes_comment_id`) REFERENCES `report_interpretive_comments`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `report_interpretive_comments_created_by_user_id_fkey` FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `report_interpretive_comments_approved_by_user_id_fkey` FOREIGN KEY (`approved_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
