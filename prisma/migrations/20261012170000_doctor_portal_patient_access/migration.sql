-- Stage 90 — doctor portal explicit patient access. This is additive and
-- does not change clinical results, report snapshots or referral history.
CREATE TABLE `doctor_portal_patient_access` (
 `id` CHAR(36) NOT NULL,
 `organization_id` CHAR(36) NOT NULL,
 `referrer_id` CHAR(36) NOT NULL,
 `patient_id` CHAR(36) NOT NULL,
 `can_view_orders` BOOLEAN NOT NULL DEFAULT TRUE,
 `can_view_reports` BOOLEAN NOT NULL DEFAULT FALSE,
 `effective_from` DATETIME(3) NOT NULL,
 `effective_to` DATETIME(3) NULL,
 `status` ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
 `reason` VARCHAR(1000) NOT NULL,
 `created_by_user_id` CHAR(36) NOT NULL,
 `revoked_at` DATETIME(3) NULL,
 `revoked_by_user_id` CHAR(36) NULL,
 `revoke_reason` VARCHAR(1000) NULL,
 `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 `updated_at` DATETIME(3) NOT NULL,
 PRIMARY KEY (`id`),
 INDEX `doctor_portal_patient_access_org_referrer_idx`(`organization_id`,`referrer_id`,`status`,`effective_from`,`effective_to`),
 INDEX `doctor_portal_patient_access_org_patient_idx`(`organization_id`,`patient_id`,`status`),
 INDEX `doctor_portal_patient_access_ref_patient_idx`(`referrer_id`,`patient_id`,`created_at`),
 CONSTRAINT `doctor_access_org_fk` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT `doctor_access_referrer_fk` FOREIGN KEY (`referrer_id`) REFERENCES `referrers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT `doctor_access_patient_fk` FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT `doctor_access_creator_fk` FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT `doctor_access_revoker_fk` FOREIGN KEY (`revoked_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
