CREATE TABLE `order_item_analyzer_routes` (
  `order_item_id` CHAR(36) NOT NULL,
  `analyzer_id` CHAR(36) NOT NULL,
  `assigned_by_user_id` CHAR(36) NOT NULL,
  `assigned_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `analyzer_code_snapshot` VARCHAR(80) NOT NULL,
  `analyzer_name_snapshot` VARCHAR(200) NOT NULL,
  `analyzer_branch_id_snapshot` CHAR(36) NOT NULL,
  PRIMARY KEY (`order_item_id`, `analyzer_id`),
  INDEX `order_item_analyzer_routes_analyzer_assigned_idx`(`analyzer_id`, `assigned_at`),
  INDEX `order_item_analyzer_routes_actor_assigned_idx`(`assigned_by_user_id`, `assigned_at`),
  CONSTRAINT `order_item_analyzer_routes_order_item_fk` FOREIGN KEY (`order_item_id`) REFERENCES `order_items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `order_item_analyzer_routes_analyzer_fk` FOREIGN KEY (`analyzer_id`) REFERENCES `analyzers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `order_item_analyzer_routes_actor_fk` FOREIGN KEY (`assigned_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `order_item_analyzer_route_events` (
  `id` CHAR(36) NOT NULL,
  `order_item_id` CHAR(36) NOT NULL,
  `analyzer_id` CHAR(36) NOT NULL,
  `action` ENUM('ASSIGNED','CLEARED') NOT NULL,
  `analyzer_code_snapshot` VARCHAR(80) NOT NULL,
  `analyzer_name_snapshot` VARCHAR(200) NOT NULL,
  `analyzer_branch_id_snapshot` CHAR(36) NOT NULL,
  `actor_user_id` CHAR(36) NOT NULL,
  `reason` VARCHAR(1000) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `order_item_analyzer_route_events_item_created_idx`(`order_item_id`, `created_at`),
  INDEX `order_item_analyzer_route_events_analyzer_created_idx`(`analyzer_id`, `created_at`),
  INDEX `order_item_analyzer_route_events_actor_created_idx`(`actor_user_id`, `created_at`),
  CONSTRAINT `order_item_analyzer_route_events_order_item_fk` FOREIGN KEY (`order_item_id`) REFERENCES `order_items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `order_item_analyzer_route_events_analyzer_fk` FOREIGN KEY (`analyzer_id`) REFERENCES `analyzers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `order_item_analyzer_route_events_actor_fk` FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT IGNORE INTO `permissions` (`id`,`code`,`module`,`description`,`created_at`) VALUES
(UUID(),'worklists.route','laboratory','Assign laboratory work items to analyzers',CURRENT_TIMESTAMP(3));

INSERT IGNORE INTO `role_permissions` (`role_id`,`permission_id`,`granted_at`)
SELECT r.id, p.id, CURRENT_TIMESTAMP(3)
FROM `roles` r
JOIN `permissions` p ON p.code = 'worklists.route'
WHERE r.code = 'SYSTEM_ADMIN';
