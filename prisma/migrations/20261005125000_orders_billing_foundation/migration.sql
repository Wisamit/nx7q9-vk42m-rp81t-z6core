CREATE TABLE `contracts` (
  `id` CHAR(36) NOT NULL,
  `organization_id` CHAR(36) NOT NULL,
  `client_id` CHAR(36) NOT NULL,
  `code` VARCHAR(60) NOT NULL,
  `name_en` VARCHAR(220) NOT NULL,
  `name_ar` VARCHAR(220) NULL,
  `currency` CHAR(3) NOT NULL,
  `effective_from` DATETIME(3) NOT NULL,
  `effective_to` DATETIME(3) NULL,
  `status` ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  `deactivated_at` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `contracts_org_code_key`(`organization_id`,`code`),
  INDEX `contracts_client_status_dates_idx`(`client_id`,`status`,`effective_from`,`effective_to`),
  CONSTRAINT `contracts_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `contracts_client_id_fkey` FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `price_lists` (
  `id` CHAR(36) NOT NULL,
  `organization_id` CHAR(36) NOT NULL,
  `code` VARCHAR(60) NOT NULL,
  `name_en` VARCHAR(220) NOT NULL,
  `name_ar` VARCHAR(220) NULL,
  `scope_type` ENUM('ORGANIZATION','BRANCH','CLIENT','CONTRACT') NOT NULL DEFAULT 'ORGANIZATION',
  `branch_id` CHAR(36) NULL,
  `client_id` CHAR(36) NULL,
  `contract_id` CHAR(36) NULL,
  `currency` CHAR(3) NOT NULL,
  `priority` INT NOT NULL DEFAULT 0,
  `effective_from` DATETIME(3) NOT NULL,
  `effective_to` DATETIME(3) NULL,
  `status` ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  `deactivated_at` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `price_lists_org_code_key`(`organization_id`,`code`),
  INDEX `price_lists_scope_status_dates_idx`(`organization_id`,`scope_type`,`status`,`effective_from`,`effective_to`),
  INDEX `price_lists_branch_status_idx`(`branch_id`,`status`),
  INDEX `price_lists_client_status_idx`(`client_id`,`status`),
  INDEX `price_lists_contract_status_idx`(`contract_id`,`status`),
  CONSTRAINT `price_lists_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `price_lists_branch_id_fkey` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `price_lists_client_id_fkey` FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `price_lists_contract_id_fkey` FOREIGN KEY (`contract_id`) REFERENCES `contracts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `price_list_items` (
  `id` CHAR(36) NOT NULL,
  `price_list_id` CHAR(36) NOT NULL,
  `test_id` CHAR(36) NOT NULL,
  `unit_price` DECIMAL(18,4) NOT NULL,
  `effective_from` DATETIME(3) NOT NULL,
  `effective_to` DATETIME(3) NULL,
  `status` ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  `deactivated_at` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `price_list_items_list_test_from_key`(`price_list_id`,`test_id`,`effective_from`),
  INDEX `price_list_items_test_status_dates_idx`(`test_id`,`status`,`effective_from`,`effective_to`),
  CONSTRAINT `price_list_items_price_list_id_fkey` FOREIGN KEY (`price_list_id`) REFERENCES `price_lists`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `price_list_items_test_id_fkey` FOREIGN KEY (`test_id`) REFERENCES `lab_tests`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `orders` (
  `id` CHAR(36) NOT NULL,
  `organization_id` CHAR(36) NOT NULL,
  `accession_number` VARCHAR(50) NOT NULL,
  `ordering_branch_id` CHAR(36) NOT NULL,
  `patient_id` CHAR(36) NOT NULL,
  `referrer_id` CHAR(36) NULL,
  `client_id` CHAR(36) NULL,
  `priority` ENUM('ROUTINE','URGENT','STAT') NOT NULL DEFAULT 'ROUTINE',
  `status` ENUM('DRAFT','REGISTERED','COLLECTED','IN_PROGRESS','COMPLETED','CANCELLED') NOT NULL DEFAULT 'REGISTERED',
  `clinical_notes` TEXT NULL,
  `diagnosis` VARCHAR(500) NULL,
  `fasting` BOOLEAN NULL,
  `pregnancy_info` VARCHAR(500) NULL,
  `ordered_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `created_by_user_id` CHAR(36) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `orders_org_accession_key`(`organization_id`,`accession_number`),
  INDEX `orders_branch_ordered_at_idx`(`ordering_branch_id`,`ordered_at`),
  INDEX `orders_patient_ordered_at_idx`(`patient_id`,`ordered_at`),
  INDEX `orders_client_ordered_at_idx`(`client_id`,`ordered_at`),
  CONSTRAINT `orders_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `orders_ordering_branch_id_fkey` FOREIGN KEY (`ordering_branch_id`) REFERENCES `branches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `orders_patient_id_fkey` FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `orders_referrer_id_fkey` FOREIGN KEY (`referrer_id`) REFERENCES `referrers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `orders_client_id_fkey` FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `orders_created_by_user_id_fkey` FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `order_items` (
  `id` CHAR(36) NOT NULL,
  `order_id` CHAR(36) NOT NULL,
  `test_id` CHAR(36) NOT NULL,
  `performed_branch_id` CHAR(36) NULL,
  `price_list_item_id` CHAR(36) NULL,
  `test_code_snapshot` VARCHAR(80) NOT NULL,
  `test_name_en_snapshot` VARCHAR(220) NOT NULL,
  `test_name_ar_snapshot` VARCHAR(220) NULL,
  `unit_snapshot` VARCHAR(80) NULL,
  `unit_price_snapshot` DECIMAL(18,4) NOT NULL DEFAULT 0,
  `discount_amount_snapshot` DECIMAL(18,4) NOT NULL DEFAULT 0,
  `tax_amount_snapshot` DECIMAL(18,4) NOT NULL DEFAULT 0,
  `final_price_snapshot` DECIMAL(18,4) NOT NULL DEFAULT 0,
  `currency` CHAR(3) NOT NULL,
  `status` ENUM('ORDERED','COLLECTED','IN_PROGRESS','RESULTED','VERIFIED','CANCELLED') NOT NULL DEFAULT 'ORDERED',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `order_items_order_test_key`(`order_id`,`test_id`),
  INDEX `order_items_performed_branch_status_idx`(`performed_branch_id`,`status`),
  INDEX `order_items_test_status_idx`(`test_id`,`status`),
  CONSTRAINT `order_items_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `order_items_test_id_fkey` FOREIGN KEY (`test_id`) REFERENCES `lab_tests`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `order_items_performed_branch_id_fkey` FOREIGN KEY (`performed_branch_id`) REFERENCES `branches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `order_items_price_list_item_id_fkey` FOREIGN KEY (`price_list_item_id`) REFERENCES `price_list_items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `invoices` (
  `id` CHAR(36) NOT NULL,
  `organization_id` CHAR(36) NOT NULL,
  `branch_id` CHAR(36) NOT NULL,
  `order_id` CHAR(36) NULL,
  `client_id` CHAR(36) NULL,
  `invoice_number` VARCHAR(50) NOT NULL,
  `status` ENUM('DRAFT','ISSUED','PARTIALLY_PAID','PAID','VOID','CREDITED') NOT NULL DEFAULT 'ISSUED',
  `currency` CHAR(3) NOT NULL,
  `subtotal` DECIMAL(18,4) NOT NULL DEFAULT 0,
  `discount_total` DECIMAL(18,4) NOT NULL DEFAULT 0,
  `tax_total` DECIMAL(18,4) NOT NULL DEFAULT 0,
  `total` DECIMAL(18,4) NOT NULL DEFAULT 0,
  `paid_amount` DECIMAL(18,4) NOT NULL DEFAULT 0,
  `balance_amount` DECIMAL(18,4) NOT NULL DEFAULT 0,
  `issued_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `created_by_user_id` CHAR(36) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `invoices_org_invoice_number_key`(`organization_id`,`invoice_number`),
  INDEX `invoices_branch_issued_at_idx`(`branch_id`,`issued_at`),
  INDEX `invoices_client_status_issued_at_idx`(`client_id`,`status`,`issued_at`),
  CONSTRAINT `invoices_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `invoices_branch_id_fkey` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `invoices_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `invoices_client_id_fkey` FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `invoices_created_by_user_id_fkey` FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `invoice_lines` (
  `id` CHAR(36) NOT NULL,
  `invoice_id` CHAR(36) NOT NULL,
  `order_item_id` CHAR(36) NULL,
  `description` VARCHAR(255) NOT NULL,
  `test_code_snapshot` VARCHAR(80) NULL,
  `test_name_en_snapshot` VARCHAR(220) NULL,
  `quantity` DECIMAL(12,3) NOT NULL DEFAULT 1,
  `unit_price` DECIMAL(18,4) NOT NULL,
  `discount_amount` DECIMAL(18,4) NOT NULL DEFAULT 0,
  `tax_amount` DECIMAL(18,4) NOT NULL DEFAULT 0,
  `line_total` DECIMAL(18,4) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `invoice_lines_invoice_id_idx`(`invoice_id`),
  INDEX `invoice_lines_order_item_id_idx`(`order_item_id`),
  CONSTRAINT `invoice_lines_invoice_id_fkey` FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `invoice_lines_order_item_id_fkey` FOREIGN KEY (`order_item_id`) REFERENCES `order_items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `payments` (
  `id` CHAR(36) NOT NULL,
  `organization_id` CHAR(36) NOT NULL,
  `branch_id` CHAR(36) NOT NULL,
  `amount` DECIMAL(18,4) NOT NULL,
  `currency` CHAR(3) NOT NULL,
  `method` ENUM('CASH','CARD','BANK_TRANSFER','ONLINE','CREDIT_ACCOUNT','OTHER') NOT NULL,
  `status` ENUM('POSTED','VOIDED','REFUNDED') NOT NULL DEFAULT 'POSTED',
  `reference` VARCHAR(150) NULL,
  `received_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `cashier_user_id` CHAR(36) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `payments_branch_received_at_idx`(`branch_id`,`received_at`),
  INDEX `payments_cashier_received_at_idx`(`cashier_user_id`,`received_at`),
  CONSTRAINT `payments_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `payments_branch_id_fkey` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `payments_cashier_user_id_fkey` FOREIGN KEY (`cashier_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `payment_allocations` (
  `payment_id` CHAR(36) NOT NULL,
  `invoice_id` CHAR(36) NOT NULL,
  `amount` DECIMAL(18,4) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`payment_id`,`invoice_id`),
  INDEX `payment_allocations_invoice_id_idx`(`invoice_id`),
  CONSTRAINT `payment_allocations_payment_id_fkey` FOREIGN KEY (`payment_id`) REFERENCES `payments`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `payment_allocations_invoice_id_fkey` FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT IGNORE INTO `permissions` (`id`,`code`,`module`,`description`,`created_at`) VALUES
(UUID(),'pricing.view','billing','View price lists',CURRENT_TIMESTAMP(3)),
(UUID(),'pricing.manage','billing','Manage effective-dated price lists',CURRENT_TIMESTAMP(3)),
(UUID(),'orders.view','orders','View laboratory orders',CURRENT_TIMESTAMP(3)),
(UUID(),'orders.create','orders','Create laboratory orders',CURRENT_TIMESTAMP(3)),
(UUID(),'billing.view','billing','View invoices and balances',CURRENT_TIMESTAMP(3)),
(UUID(),'billing.manage','billing','Manage invoices and payments',CURRENT_TIMESTAMP(3));

INSERT IGNORE INTO `role_permissions` (`role_id`,`permission_id`,`granted_at`)
SELECT r.id, p.id, CURRENT_TIMESTAMP(3)
FROM `roles` r
JOIN `permissions` p ON p.code IN ('pricing.view','pricing.manage','orders.view','orders.create','billing.view','billing.manage')
WHERE r.code='SYSTEM_ADMIN';
