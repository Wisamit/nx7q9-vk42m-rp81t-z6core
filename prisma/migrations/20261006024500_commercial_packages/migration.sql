-- Commercial packages are distinct from clinical panels/profiles.
-- They carry their own effective-dated commercial price while member tests
-- remain independently traceable clinical order items.

CREATE TABLE `commercial_packages` (
  `id` CHAR(36) NOT NULL,
  `organization_id` CHAR(36) NOT NULL,
  `code` VARCHAR(80) NOT NULL,
  `name_en` VARCHAR(220) NOT NULL,
  `name_ar` VARCHAR(220) NULL,
  `description_en` TEXT NULL,
  `description_ar` TEXT NULL,
  `status` ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  `deactivated_at` DATETIME(3) NULL,
  UNIQUE INDEX `commercial_packages_organization_id_code_key`(`organization_id`, `code`),
  INDEX `commercial_packages_organization_id_status_idx`(`organization_id`, `status`),
  PRIMARY KEY (`id`),
  CONSTRAINT `commercial_packages_organization_id_fkey`
    FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `commercial_package_items` (
  `package_id` CHAR(36) NOT NULL,
  `test_id` CHAR(36) NOT NULL,
  `display_order` INTEGER NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `commercial_package_items_test_id_idx`(`test_id`),
  PRIMARY KEY (`package_id`, `test_id`),
  CONSTRAINT `commercial_package_items_package_id_fkey`
    FOREIGN KEY (`package_id`) REFERENCES `commercial_packages`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `commercial_package_items_test_id_fkey`
    FOREIGN KEY (`test_id`) REFERENCES `lab_tests`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `price_list_package_items` (
  `id` CHAR(36) NOT NULL,
  `price_list_id` CHAR(36) NOT NULL,
  `package_id` CHAR(36) NOT NULL,
  `unit_price` DECIMAL(18,4) NOT NULL,
  `effective_from` DATETIME(3) NOT NULL,
  `effective_to` DATETIME(3) NULL,
  `status` ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  `deactivated_at` DATETIME(3) NULL,
  UNIQUE INDEX `pl_pkg_item_effective_uq`(`price_list_id`, `package_id`, `effective_from`),
  INDEX `pl_pkg_item_effective_idx`(`package_id`, `status`, `effective_from`, `effective_to`),
  PRIMARY KEY (`id`),
  CONSTRAINT `price_list_package_items_price_list_id_fkey`
    FOREIGN KEY (`price_list_id`) REFERENCES `price_lists`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `price_list_package_items_package_id_fkey`
    FOREIGN KEY (`package_id`) REFERENCES `commercial_packages`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `order_packages` (
  `id` CHAR(36) NOT NULL,
  `order_id` CHAR(36) NOT NULL,
  `package_id` CHAR(36) NOT NULL,
  `price_list_package_item_id` CHAR(36) NULL,
  `package_code_snapshot` VARCHAR(80) NOT NULL,
  `package_name_en_snapshot` VARCHAR(220) NOT NULL,
  `package_name_ar_snapshot` VARCHAR(220) NULL,
  `unit_price_snapshot` DECIMAL(18,4) NOT NULL,
  `discount_amount_snapshot` DECIMAL(18,4) NOT NULL DEFAULT 0,
  `tax_amount_snapshot` DECIMAL(18,4) NOT NULL DEFAULT 0,
  `final_price_snapshot` DECIMAL(18,4) NOT NULL,
  `currency` CHAR(3) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `order_packages_order_id_package_id_key`(`order_id`, `package_id`),
  INDEX `order_packages_package_id_idx`(`package_id`),
  INDEX `order_packages_price_list_package_item_id_idx`(`price_list_package_item_id`),
  PRIMARY KEY (`id`),
  CONSTRAINT `order_packages_order_id_fkey`
    FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `order_packages_package_id_fkey`
    FOREIGN KEY (`package_id`) REFERENCES `commercial_packages`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `order_packages_price_list_package_item_id_fkey`
    FOREIGN KEY (`price_list_package_item_id`) REFERENCES `price_list_package_items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `order_package_items` (
  `order_package_id` CHAR(36) NOT NULL,
  `order_item_id` CHAR(36) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `order_package_items_order_item_id_idx`(`order_item_id`),
  PRIMARY KEY (`order_package_id`, `order_item_id`),
  CONSTRAINT `order_package_items_order_package_id_fkey`
    FOREIGN KEY (`order_package_id`) REFERENCES `order_packages`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `order_package_items_order_item_id_fkey`
    FOREIGN KEY (`order_item_id`) REFERENCES `order_items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `invoice_lines`
  ADD COLUMN `order_package_id` CHAR(36) NULL AFTER `order_item_id`,
  ADD INDEX `invoice_lines_order_package_id_idx`(`order_package_id`),
  ADD CONSTRAINT `invoice_lines_order_package_id_fkey`
    FOREIGN KEY (`order_package_id`) REFERENCES `order_packages`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
