CREATE TABLE `patients` (
  `id` CHAR(36) NOT NULL,
  `organization_id` CHAR(36) NOT NULL,
  `patient_number` VARCHAR(40) NOT NULL,
  `full_name_en` VARCHAR(220) NOT NULL,
  `full_name_ar` VARCHAR(220) NULL,
  `normalized_name` VARCHAR(220) NOT NULL,
  `date_of_birth` DATE NULL,
  `sex_at_birth` ENUM('MALE','FEMALE','UNKNOWN') NOT NULL DEFAULT 'UNKNOWN',
  `phone` VARCHAR(50) NULL,
  `normalized_phone` VARCHAR(50) NULL,
  `email` VARCHAR(191) NULL,
  `nationality_code` CHAR(2) NULL,
  `status` ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  `deactivated_at` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `patients_org_patient_number_key`(`organization_id`,`patient_number`),
  INDEX `patients_org_normalized_name_idx`(`organization_id`,`normalized_name`),
  INDEX `patients_org_normalized_phone_idx`(`organization_id`,`normalized_phone`),
  INDEX `patients_org_date_of_birth_idx`(`organization_id`,`date_of_birth`),
  CONSTRAINT `patients_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `patient_identifiers` (
  `id` CHAR(36) NOT NULL,
  `organization_id` CHAR(36) NOT NULL,
  `patient_id` CHAR(36) NOT NULL,
  `identifier_type` ENUM('NATIONAL_ID','PASSPORT','OTHER') NOT NULL,
  `value` VARCHAR(120) NOT NULL,
  `normalized_value` VARCHAR(120) NOT NULL,
  `issuing_country` CHAR(2) NULL,
  `is_primary` BOOLEAN NOT NULL DEFAULT false,
  `status` ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `patient_identifiers_org_type_value_key`(`organization_id`,`identifier_type`,`normalized_value`),
  INDEX `patient_identifiers_patient_id_status_idx`(`patient_id`,`status`),
  CONSTRAINT `patient_identifiers_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `patient_identifiers_patient_id_fkey` FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT IGNORE INTO `permissions` (`id`,`code`,`module`,`description`,`created_at`) VALUES
(UUID(),'patients.view','patients','View patients',CURRENT_TIMESTAMP(3)),
(UUID(),'patients.manage','patients','Create and update patients',CURRENT_TIMESTAMP(3));

INSERT IGNORE INTO `role_permissions` (`role_id`,`permission_id`,`granted_at`)
SELECT r.id, p.id, CURRENT_TIMESTAMP(3)
FROM `roles` r
JOIN `permissions` p ON p.code IN ('patients.view','patients.manage')
WHERE r.code='SYSTEM_ADMIN';
