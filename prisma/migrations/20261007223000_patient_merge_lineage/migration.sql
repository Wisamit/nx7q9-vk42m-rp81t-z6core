-- Patient identity merge keeps historical orders/results on their original patient row.
-- The source row becomes an inactive alias pointing to the active canonical patient.
ALTER TABLE `patients`
  ADD COLUMN `merged_into_patient_id` CHAR(36) NULL AFTER `status`,
  ADD COLUMN `merged_at` DATETIME(3) NULL AFTER `merged_into_patient_id`,
  ADD INDEX `patients_merged_into_status_idx`(`merged_into_patient_id`, `status`),
  ADD CONSTRAINT `patients_merged_into_fkey`
    FOREIGN KEY (`merged_into_patient_id`) REFERENCES `patients`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE `patient_merge_events` (
  `id` CHAR(36) NOT NULL,
  `organization_id` CHAR(36) NOT NULL,
  `source_patient_id` CHAR(36) NOT NULL,
  `target_patient_id` CHAR(36) NOT NULL,
  `source_patient_number_snapshot` VARCHAR(40) NOT NULL,
  `target_patient_number_snapshot` VARCHAR(40) NOT NULL,
  `reason` VARCHAR(1000) NOT NULL,
  `merged_by_user_id` CHAR(36) NOT NULL,
  `merged_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `patient_merge_events_source_key`(`source_patient_id`),
  INDEX `patient_merge_events_target_time_idx`(`target_patient_id`, `merged_at`),
  INDEX `patient_merge_events_actor_time_idx`(`merged_by_user_id`, `merged_at`),
  CONSTRAINT `patient_merge_events_org_fkey`
    FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `patient_merge_events_source_fkey`
    FOREIGN KEY (`source_patient_id`) REFERENCES `patients`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `patient_merge_events_target_fkey`
    FOREIGN KEY (`target_patient_id`) REFERENCES `patients`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `patient_merge_events_actor_fkey`
    FOREIGN KEY (`merged_by_user_id`) REFERENCES `users`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT IGNORE INTO `permissions` (`id`,`code`,`module`,`description`,`created_at`)
VALUES (UUID(),'patients.merge','patients','Merge duplicate patient identities with immutable audit evidence',CURRENT_TIMESTAMP(3));

INSERT IGNORE INTO `role_permissions` (`role_id`,`permission_id`,`granted_at`)
SELECT r.id,p.id,CURRENT_TIMESTAMP(3)
FROM `roles` r
JOIN `permissions` p ON p.code='patients.merge'
WHERE r.code='SYSTEM_ADMIN';
