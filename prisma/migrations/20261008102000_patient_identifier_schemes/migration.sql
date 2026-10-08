CREATE TABLE `patient_identifier_schemes` (
  `id` CHAR(36) NOT NULL,
  `organization_id` CHAR(36) NOT NULL,
  `code` VARCHAR(80) NOT NULL,
  `name_en` VARCHAR(180) NOT NULL,
  `name_ar` VARCHAR(180) NULL,
  `identifier_type` ENUM('NATIONAL_ID','PASSPORT','OTHER') NOT NULL DEFAULT 'OTHER',
  `requires_issuing_country` BOOLEAN NOT NULL DEFAULT false,
  `status` ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  `deactivated_at` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `patient_identifier_schemes_org_code_key`(`organization_id`,`code`),
  INDEX `patient_identifier_schemes_org_status_idx`(`organization_id`,`status`),
  CONSTRAINT `patient_identifier_schemes_org_fkey`
    FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `patient_identifier_schemes`
(`id`,`organization_id`,`code`,`name_en`,`name_ar`,`identifier_type`,`requires_issuing_country`,`status`,`created_at`,`updated_at`)
SELECT UUID(), o.id, 'NATIONAL_ID', 'National ID', 'الرقم الوطني', 'NATIONAL_ID', false, 'ACTIVE', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
FROM `organizations` o;

INSERT INTO `patient_identifier_schemes`
(`id`,`organization_id`,`code`,`name_en`,`name_ar`,`identifier_type`,`requires_issuing_country`,`status`,`created_at`,`updated_at`)
SELECT UUID(), o.id, 'PASSPORT', 'Passport', 'جواز السفر', 'PASSPORT', false, 'ACTIVE', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
FROM `organizations` o;

INSERT INTO `patient_identifier_schemes`
(`id`,`organization_id`,`code`,`name_en`,`name_ar`,`identifier_type`,`requires_issuing_country`,`status`,`created_at`,`updated_at`)
SELECT UUID(), o.id, 'LEGACY_OTHER', 'Legacy Other Identifier', 'معرّف تاريخي آخر', 'OTHER', false, 'ACTIVE', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
FROM `organizations` o;

ALTER TABLE `patient_identifiers`
  ADD COLUMN `scheme_id` CHAR(36) NULL AFTER `patient_id`;

UPDATE `patient_identifiers` pi
JOIN `patient_identifier_schemes` s
  ON s.organization_id = pi.organization_id
 AND s.code = CASE
   WHEN pi.identifier_type = 'NATIONAL_ID' THEN 'NATIONAL_ID'
   WHEN pi.identifier_type = 'PASSPORT' THEN 'PASSPORT'
   ELSE 'LEGACY_OTHER'
 END
SET pi.scheme_id = s.id
WHERE pi.scheme_id IS NULL;

ALTER TABLE `patient_identifiers`
  DROP INDEX `patient_identifiers_org_type_value_key`,
  MODIFY COLUMN `scheme_id` CHAR(36) NOT NULL,
  ADD UNIQUE INDEX `patient_identifiers_org_scheme_value_key`(`organization_id`,`scheme_id`,`normalized_value`),
  ADD INDEX `patient_identifiers_scheme_status_idx`(`scheme_id`,`status`),
  ADD CONSTRAINT `patient_identifiers_scheme_id_fkey`
    FOREIGN KEY (`scheme_id`) REFERENCES `patient_identifier_schemes`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;
