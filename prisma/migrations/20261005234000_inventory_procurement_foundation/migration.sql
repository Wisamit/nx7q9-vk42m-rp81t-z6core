CREATE TABLE `inventory_categories` (
  `id` CHAR(36) NOT NULL,
  `organization_id` CHAR(36) NOT NULL,
  `code` VARCHAR(80) NOT NULL,
  `name_en` VARCHAR(200) NOT NULL,
  `name_ar` VARCHAR(200) NULL,
  `status` ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  `deactivated_at` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `inventory_categories_org_code_key`(`organization_id`,`code`),
  INDEX `inventory_categories_org_status_idx`(`organization_id`,`status`),
  CONSTRAINT `inventory_categories_org_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `suppliers` (
  `id` CHAR(36) NOT NULL,
  `organization_id` CHAR(36) NOT NULL,
  `code` VARCHAR(80) NOT NULL,
  `name_en` VARCHAR(220) NOT NULL,
  `name_ar` VARCHAR(220) NULL,
  `phone` VARCHAR(50) NULL,
  `email` VARCHAR(191) NULL,
  `address` TEXT NULL,
  `tax_number` VARCHAR(100) NULL,
  `payment_terms` VARCHAR(500) NULL,
  `status` ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  `deactivated_at` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `suppliers_org_code_key`(`organization_id`,`code`),
  INDEX `suppliers_org_status_idx`(`organization_id`,`status`),
  CONSTRAINT `suppliers_org_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `inventory_items` (
  `id` CHAR(36) NOT NULL,
  `organization_id` CHAR(36) NOT NULL,
  `category_id` CHAR(36) NULL,
  `code` VARCHAR(80) NOT NULL,
  `name_en` VARCHAR(220) NOT NULL,
  `name_ar` VARCHAR(220) NULL,
  `item_type` ENUM('REAGENT','CONTROL','CALIBRATOR','KIT','TUBE','NEEDLE','CONSUMABLE','OTHER') NOT NULL,
  `stock_unit` VARCHAR(50) NOT NULL,
  `minimum_stock_qty` DECIMAL(18,4) NOT NULL DEFAULT 0,
  `reorder_qty` DECIMAL(18,4) NULL,
  `storage_conditions` VARCHAR(500) NULL,
  `lot_tracking` BOOLEAN NOT NULL DEFAULT true,
  `expiry_tracking` BOOLEAN NOT NULL DEFAULT true,
  `status` ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  `deactivated_at` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `inventory_items_org_code_key`(`organization_id`,`code`),
  INDEX `inventory_items_category_status_idx`(`category_id`,`status`),
  INDEX `inventory_items_org_type_status_idx`(`organization_id`,`item_type`,`status`),
  CONSTRAINT `inventory_items_org_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `inventory_items_category_fkey` FOREIGN KEY (`category_id`) REFERENCES `inventory_categories`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `inventory_lots` (
  `id` CHAR(36) NOT NULL,
  `organization_id` CHAR(36) NOT NULL,
  `item_id` CHAR(36) NOT NULL,
  `supplier_id` CHAR(36) NULL,
  `lot_number` VARCHAR(120) NOT NULL,
  `manufacturer_lot` VARCHAR(120) NULL,
  `received_date` DATE NULL,
  `expiry_date` DATE NULL,
  `opened_date` DATE NULL,
  `in_use_date` DATE NULL,
  `unit_cost` DECIMAL(18,4) NULL,
  `currency` CHAR(3) NULL,
  `status` ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  `deactivated_at` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `inventory_lots_org_item_lot_key`(`organization_id`,`item_id`,`lot_number`),
  INDEX `inventory_lots_item_expiry_status_idx`(`item_id`,`expiry_date`,`status`),
  INDEX `inventory_lots_supplier_status_idx`(`supplier_id`,`status`),
  CONSTRAINT `inventory_lots_org_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `inventory_lots_item_fkey` FOREIGN KEY (`item_id`) REFERENCES `inventory_items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `inventory_lots_supplier_fkey` FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `branch_stock` (
  `id` CHAR(36) NOT NULL,
  `branch_id` CHAR(36) NOT NULL,
  `item_id` CHAR(36) NOT NULL,
  `quantity_on_hand` DECIMAL(18,4) NOT NULL DEFAULT 0,
  `reserved_qty` DECIMAL(18,4) NOT NULL DEFAULT 0,
  `updated_at` DATETIME(3) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `branch_stock_branch_item_key`(`branch_id`,`item_id`),
  INDEX `branch_stock_item_idx`(`item_id`),
  CONSTRAINT `branch_stock_branch_fkey` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `branch_stock_item_fkey` FOREIGN KEY (`item_id`) REFERENCES `inventory_items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `inventory_lot_stock` (
  `id` CHAR(36) NOT NULL,
  `branch_id` CHAR(36) NOT NULL,
  `lot_id` CHAR(36) NOT NULL,
  `quantity_on_hand` DECIMAL(18,4) NOT NULL DEFAULT 0,
  `reserved_qty` DECIMAL(18,4) NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `inventory_lot_stock_branch_lot_key`(`branch_id`,`lot_id`),
  INDEX `inventory_lot_stock_lot_idx`(`lot_id`),
  CONSTRAINT `inventory_lot_stock_branch_fkey` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `inventory_lot_stock_lot_fkey` FOREIGN KEY (`lot_id`) REFERENCES `inventory_lots`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `stock_movements` (
  `id` CHAR(36) NOT NULL,
  `organization_id` CHAR(36) NOT NULL,
  `branch_id` CHAR(36) NOT NULL,
  `item_id` CHAR(36) NOT NULL,
  `lot_id` CHAR(36) NULL,
  `movement_type` ENUM('RECEIPT','ISSUE','CONSUMPTION','ADJUSTMENT_IN','ADJUSTMENT_OUT','TRANSFER_OUT','TRANSFER_IN','RETURN','DISPOSAL') NOT NULL,
  `quantity` DECIMAL(18,4) NOT NULL,
  `balance_after` DECIMAL(18,4) NOT NULL,
  `reference_type` VARCHAR(80) NULL,
  `reference_id` CHAR(36) NULL,
  `reason` VARCHAR(500) NULL,
  `actor_user_id` CHAR(36) NOT NULL,
  `occurred_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `stock_movements_branch_item_occurred_idx`(`branch_id`,`item_id`,`occurred_at`),
  INDEX `stock_movements_lot_occurred_idx`(`lot_id`,`occurred_at`),
  INDEX `stock_movements_reference_idx`(`reference_type`,`reference_id`),
  CONSTRAINT `stock_movements_org_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `stock_movements_branch_fkey` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `stock_movements_item_fkey` FOREIGN KEY (`item_id`) REFERENCES `inventory_items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `stock_movements_lot_fkey` FOREIGN KEY (`lot_id`) REFERENCES `inventory_lots`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `stock_movements_actor_fkey` FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `inventory_transfers` (
  `id` CHAR(36) NOT NULL,
  `organization_id` CHAR(36) NOT NULL,
  `transfer_number` VARCHAR(80) NOT NULL,
  `source_branch_id` CHAR(36) NOT NULL,
  `destination_branch_id` CHAR(36) NOT NULL,
  `status` ENUM('DRAFT','APPROVED','DISPATCHED','PARTIALLY_RECEIVED','RECEIVED','CANCELLED') NOT NULL DEFAULT 'DRAFT',
  `notes` TEXT NULL,
  `requested_by_user_id` CHAR(36) NOT NULL,
  `requested_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `approved_by_user_id` CHAR(36) NULL,
  `approved_at` DATETIME(3) NULL,
  `dispatched_by_user_id` CHAR(36) NULL,
  `dispatched_at` DATETIME(3) NULL,
  `received_by_user_id` CHAR(36) NULL,
  `received_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `inventory_transfers_org_number_key`(`organization_id`,`transfer_number`),
  INDEX `inventory_transfers_source_status_idx`(`source_branch_id`,`status`,`requested_at`),
  INDEX `inventory_transfers_destination_status_idx`(`destination_branch_id`,`status`,`requested_at`),
  CONSTRAINT `inventory_transfers_org_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `inventory_transfers_source_branch_fkey` FOREIGN KEY (`source_branch_id`) REFERENCES `branches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `inventory_transfers_destination_branch_fkey` FOREIGN KEY (`destination_branch_id`) REFERENCES `branches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `inventory_transfers_requested_by_fkey` FOREIGN KEY (`requested_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `inventory_transfers_approved_by_fkey` FOREIGN KEY (`approved_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `inventory_transfers_dispatched_by_fkey` FOREIGN KEY (`dispatched_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `inventory_transfers_received_by_fkey` FOREIGN KEY (`received_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `inventory_transfer_items` (
  `id` CHAR(36) NOT NULL,
  `transfer_id` CHAR(36) NOT NULL,
  `item_id` CHAR(36) NOT NULL,
  `lot_id` CHAR(36) NOT NULL,
  `requested_qty` DECIMAL(18,4) NOT NULL,
  `approved_qty` DECIMAL(18,4) NULL,
  `dispatched_qty` DECIMAL(18,4) NULL,
  `received_qty` DECIMAL(18,4) NULL,
  `discrepancy_qty` DECIMAL(18,4) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `inventory_transfer_items_transfer_lot_key`(`transfer_id`,`lot_id`),
  INDEX `inventory_transfer_items_item_idx`(`item_id`),
  CONSTRAINT `inventory_transfer_items_transfer_fkey` FOREIGN KEY (`transfer_id`) REFERENCES `inventory_transfers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `inventory_transfer_items_item_fkey` FOREIGN KEY (`item_id`) REFERENCES `inventory_items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `inventory_transfer_items_lot_fkey` FOREIGN KEY (`lot_id`) REFERENCES `inventory_lots`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `purchase_requests` (
  `id` CHAR(36) NOT NULL,
  `organization_id` CHAR(36) NOT NULL,
  `branch_id` CHAR(36) NOT NULL,
  `request_number` VARCHAR(80) NOT NULL,
  `status` ENUM('DRAFT','SUBMITTED','APPROVED','REJECTED','CONVERTED','CANCELLED') NOT NULL DEFAULT 'DRAFT',
  `notes` TEXT NULL,
  `requested_by_user_id` CHAR(36) NOT NULL,
  `requested_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `approved_by_user_id` CHAR(36) NULL,
  `approved_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `purchase_requests_org_number_key`(`organization_id`,`request_number`),
  INDEX `purchase_requests_branch_status_idx`(`branch_id`,`status`,`requested_at`),
  CONSTRAINT `purchase_requests_org_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `purchase_requests_branch_fkey` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `purchase_requests_requested_by_fkey` FOREIGN KEY (`requested_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `purchase_requests_approved_by_fkey` FOREIGN KEY (`approved_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `purchase_request_items` (
  `id` CHAR(36) NOT NULL,
  `purchase_request_id` CHAR(36) NOT NULL,
  `item_id` CHAR(36) NOT NULL,
  `requested_qty` DECIMAL(18,4) NOT NULL,
  `estimated_unit_cost` DECIMAL(18,4) NULL,
  `currency` CHAR(3) NULL,
  `notes` VARCHAR(500) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `purchase_request_items_request_item_key`(`purchase_request_id`,`item_id`),
  INDEX `purchase_request_items_item_idx`(`item_id`),
  CONSTRAINT `purchase_request_items_request_fkey` FOREIGN KEY (`purchase_request_id`) REFERENCES `purchase_requests`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `purchase_request_items_item_fkey` FOREIGN KEY (`item_id`) REFERENCES `inventory_items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `purchase_orders` (
  `id` CHAR(36) NOT NULL,
  `organization_id` CHAR(36) NOT NULL,
  `branch_id` CHAR(36) NOT NULL,
  `supplier_id` CHAR(36) NOT NULL,
  `purchase_request_id` CHAR(36) NULL,
  `po_number` VARCHAR(80) NOT NULL,
  `status` ENUM('DRAFT','APPROVED','SENT','PARTIALLY_RECEIVED','RECEIVED','CANCELLED') NOT NULL DEFAULT 'DRAFT',
  `currency` CHAR(3) NOT NULL,
  `supplier_reference` VARCHAR(150) NULL,
  `ordered_at` DATETIME(3) NULL,
  `expected_at` DATETIME(3) NULL,
  `created_by_user_id` CHAR(36) NOT NULL,
  `approved_by_user_id` CHAR(36) NULL,
  `approved_at` DATETIME(3) NULL,
  `notes` TEXT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `purchase_orders_org_number_key`(`organization_id`,`po_number`),
  INDEX `purchase_orders_branch_status_idx`(`branch_id`,`status`,`created_at`),
  INDEX `purchase_orders_supplier_status_idx`(`supplier_id`,`status`),
  CONSTRAINT `purchase_orders_org_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `purchase_orders_branch_fkey` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `purchase_orders_supplier_fkey` FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `purchase_orders_request_fkey` FOREIGN KEY (`purchase_request_id`) REFERENCES `purchase_requests`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `purchase_orders_created_by_fkey` FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `purchase_orders_approved_by_fkey` FOREIGN KEY (`approved_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `purchase_order_items` (
  `id` CHAR(36) NOT NULL,
  `purchase_order_id` CHAR(36) NOT NULL,
  `item_id` CHAR(36) NOT NULL,
  `ordered_qty` DECIMAL(18,4) NOT NULL,
  `received_qty` DECIMAL(18,4) NOT NULL DEFAULT 0,
  `unit_cost` DECIMAL(18,4) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `purchase_order_items_order_item_key`(`purchase_order_id`,`item_id`),
  INDEX `purchase_order_items_item_idx`(`item_id`),
  CONSTRAINT `purchase_order_items_order_fkey` FOREIGN KEY (`purchase_order_id`) REFERENCES `purchase_orders`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `purchase_order_items_item_fkey` FOREIGN KEY (`item_id`) REFERENCES `inventory_items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `goods_receipts` (
  `id` CHAR(36) NOT NULL,
  `organization_id` CHAR(36) NOT NULL,
  `branch_id` CHAR(36) NOT NULL,
  `supplier_id` CHAR(36) NOT NULL,
  `purchase_order_id` CHAR(36) NULL,
  `receipt_number` VARCHAR(80) NOT NULL,
  `supplier_reference` VARCHAR(150) NULL,
  `status` ENUM('DRAFT','POSTED','CANCELLED') NOT NULL DEFAULT 'DRAFT',
  `received_by_user_id` CHAR(36) NOT NULL,
  `received_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `posted_at` DATETIME(3) NULL,
  `notes` TEXT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `goods_receipts_org_number_key`(`organization_id`,`receipt_number`),
  INDEX `goods_receipts_branch_status_idx`(`branch_id`,`status`,`received_at`),
  INDEX `goods_receipts_supplier_idx`(`supplier_id`,`received_at`),
  CONSTRAINT `goods_receipts_org_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `goods_receipts_branch_fkey` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `goods_receipts_supplier_fkey` FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `goods_receipts_order_fkey` FOREIGN KEY (`purchase_order_id`) REFERENCES `purchase_orders`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `goods_receipts_received_by_fkey` FOREIGN KEY (`received_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `goods_receipt_items` (
  `id` CHAR(36) NOT NULL,
  `goods_receipt_id` CHAR(36) NOT NULL,
  `purchase_order_item_id` CHAR(36) NULL,
  `item_id` CHAR(36) NOT NULL,
  `lot_id` CHAR(36) NULL,
  `lot_number` VARCHAR(120) NOT NULL,
  `expiry_date` DATE NULL,
  `quantity` DECIMAL(18,4) NOT NULL,
  `unit_cost` DECIMAL(18,4) NOT NULL,
  `currency` CHAR(3) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `goods_receipt_items_receipt_idx`(`goods_receipt_id`),
  INDEX `goods_receipt_items_item_lot_number_idx`(`item_id`,`lot_number`),
  INDEX `goods_receipt_items_lot_idx`(`lot_id`),
  CONSTRAINT `goods_receipt_items_receipt_fkey` FOREIGN KEY (`goods_receipt_id`) REFERENCES `goods_receipts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `goods_receipt_items_po_item_fkey` FOREIGN KEY (`purchase_order_item_id`) REFERENCES `purchase_order_items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `goods_receipt_items_item_fkey` FOREIGN KEY (`item_id`) REFERENCES `inventory_items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `goods_receipt_items_lot_fkey` FOREIGN KEY (`lot_id`) REFERENCES `inventory_lots`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT IGNORE INTO `permissions` (`id`,`code`,`module`,`description`,`created_at`) VALUES
(UUID(),'inventory.view','inventory','View branch inventory and lot balances',CURRENT_TIMESTAMP(3)),
(UUID(),'inventory.manage','inventory','Manage inventory master data',CURRENT_TIMESTAMP(3)),
(UUID(),'inventory.adjust','inventory','Post controlled inventory adjustments',CURRENT_TIMESTAMP(3)),
(UUID(),'inventory.transfer','inventory','Manage inter-branch inventory transfers',CURRENT_TIMESTAMP(3)),
(UUID(),'procurement.view','inventory','View procurement requests, orders and receipts',CURRENT_TIMESTAMP(3)),
(UUID(),'procurement.manage','inventory','Create and manage procurement documents',CURRENT_TIMESTAMP(3)),
(UUID(),'procurement.approve','inventory','Approve purchase requests and purchase orders',CURRENT_TIMESTAMP(3)),
(UUID(),'procurement.receive','inventory','Receive and post supplier goods into inventory',CURRENT_TIMESTAMP(3));

INSERT IGNORE INTO `role_permissions` (`role_id`,`permission_id`,`granted_at`)
SELECT r.id, p.id, CURRENT_TIMESTAMP(3)
FROM `roles` r
JOIN `permissions` p ON p.code IN (
  'inventory.view','inventory.manage','inventory.adjust','inventory.transfer',
  'procurement.view','procurement.manage','procurement.approve','procurement.receive'
)
WHERE r.code='SYSTEM_ADMIN';
