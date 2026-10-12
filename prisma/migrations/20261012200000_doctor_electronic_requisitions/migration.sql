-- Stage 93: explicitly authorized physician requisitions.
-- Existing patient grants gain NO automatic electronic-order entitlement.
ALTER TABLE `doctor_portal_patient_access`
  ADD COLUMN `can_request_orders` BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE `doctor_requisitions` (
  `id` CHAR(36) NOT NULL,
  `organization_id` CHAR(36) NOT NULL,
  `branch_id` CHAR(36) NOT NULL,
  `patient_id` CHAR(36) NOT NULL,
  `referrer_id` CHAR(36) NOT NULL,
  `portal_account_id` CHAR(36) NOT NULL,
  `client_request_id` CHAR(36) NOT NULL,
  `request_fingerprint` CHAR(64) NOT NULL,
  `status` ENUM('SUBMITTED','CANCELLED','DECLINED','FULFILLED') NOT NULL DEFAULT 'SUBMITTED',
  `priority` ENUM('ROUTINE','URGENT','STAT') NOT NULL DEFAULT 'ROUTINE',
  `diagnosis` VARCHAR(500) NULL,
  `clinical_notes` TEXT NULL,
  `submitted_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `resolved_at` DATETIME(3) NULL,
  `resolved_by_user_id` CHAR(36) NULL,
  `resolution_reason` VARCHAR(1000) NULL,
  `fulfilled_order_id` CHAR(36) NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `dr_portal_request_uq` (`portal_account_id`, `client_request_id`),
  UNIQUE INDEX `dr_fulfilled_order_uq` (`fulfilled_order_id`),
  INDEX `dr_branch_queue_idx` (`organization_id`,`branch_id`,`status`,`submitted_at`),
  INDEX `dr_referrer_patient_idx` (`organization_id`,`referrer_id`,`patient_id`,`submitted_at`),
  CONSTRAINT `dr_org_fk` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `dr_branch_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `dr_patient_fk` FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `dr_referrer_fk` FOREIGN KEY (`referrer_id`) REFERENCES `referrers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `dr_portal_fk` FOREIGN KEY (`portal_account_id`) REFERENCES `portal_accounts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `dr_resolver_fk` FOREIGN KEY (`resolved_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `dr_order_fk` FOREIGN KEY (`fulfilled_order_id`) REFERENCES `orders`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `doctor_requisition_items` (
  `id` CHAR(36) NOT NULL,
  `requisition_id` CHAR(36) NOT NULL,
  `test_id` CHAR(36) NOT NULL,
  `test_code_snapshot` VARCHAR(80) NOT NULL,
  `test_name_en_snapshot` VARCHAR(220) NOT NULL,
  `test_name_ar_snapshot` VARCHAR(220) NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `dri_request_test_uq` (`requisition_id`,`test_id`),
  INDEX `dri_test_idx` (`test_id`),
  CONSTRAINT `dri_request_fk` FOREIGN KEY (`requisition_id`) REFERENCES `doctor_requisitions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `dri_test_fk` FOREIGN KEY (`test_id`) REFERENCES `lab_tests`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
