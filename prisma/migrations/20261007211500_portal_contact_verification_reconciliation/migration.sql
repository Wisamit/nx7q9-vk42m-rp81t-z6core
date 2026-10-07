CREATE TABLE `portal_contact_verifications` (
  `id` CHAR(36) NOT NULL,
  `portal_account_id` CHAR(36) NOT NULL,
  `channel` ENUM('EMAIL','PHONE') NOT NULL,
  `destination_snapshot` VARCHAR(191) NOT NULL,
  `method` ENUM('SELF_SERVICE_OTP','STAFF_CONFIRMED','LEGACY_IMPORTED') NOT NULL,
  `verification_reason` VARCHAR(1000) NOT NULL,
  `verified_by_user_id` CHAR(36) NULL,
  `verified_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `revoked_at` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  INDEX `portal_contact_verifications_account_channel_idx`(`portal_account_id`, `channel`, `revoked_at`, `verified_at`),
  INDEX `portal_contact_verifications_account_destination_idx`(`portal_account_id`, `channel`, `destination_snapshot`, `revoked_at`),
  INDEX `portal_contact_verifications_actor_idx`(`verified_by_user_id`, `verified_at`),
  CONSTRAINT `portal_contact_verifications_account_fk`
    FOREIGN KEY (`portal_account_id`) REFERENCES `portal_accounts`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `portal_contact_verifications_actor_fk`
    FOREIGN KEY (`verified_by_user_id`) REFERENCES `users`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `portal_contact_verifications`
  (`id`,`portal_account_id`,`channel`,`destination_snapshot`,`method`,`verification_reason`,`verified_by_user_id`,`verified_at`)
SELECT
  UUID(), `id`, 'EMAIL', `email`, 'LEGACY_IMPORTED',
  'Migrated from legacy contact_verified_at with a single configured email contact',
  NULL, `contact_verified_at`
FROM `portal_accounts`
WHERE `contact_verified_at` IS NOT NULL
  AND `email` IS NOT NULL
  AND `phone` IS NULL;

INSERT INTO `portal_contact_verifications`
  (`id`,`portal_account_id`,`channel`,`destination_snapshot`,`method`,`verification_reason`,`verified_by_user_id`,`verified_at`)
SELECT
  UUID(), `id`, 'PHONE', `phone`, 'LEGACY_IMPORTED',
  'Migrated from legacy contact_verified_at with a single configured phone contact',
  NULL, `contact_verified_at`
FROM `portal_accounts`
WHERE `contact_verified_at` IS NOT NULL
  AND `phone` IS NOT NULL
  AND `email` IS NULL;
