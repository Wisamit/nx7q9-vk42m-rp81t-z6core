CREATE TABLE `portal_contact_verifications` (
  `id` CHAR(36) NOT NULL,
  `portal_account_id` CHAR(36) NOT NULL,
  `channel` ENUM('EMAIL','PHONE') NOT NULL,
  `destination_snapshot` VARCHAR(191) NOT NULL,
  `method` ENUM('STAFF_CONFIRMED') NOT NULL DEFAULT 'STAFF_CONFIRMED',
  `verification_reason` VARCHAR(1000) NOT NULL,
  `verified_by_user_id` CHAR(36) NOT NULL,
  `verified_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `revoked_at` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  INDEX `portal_contact_verifications_account_channel_idx`(`portal_account_id`, `channel`, `revoked_at`, `verified_at`),
  INDEX `portal_contact_verifications_actor_idx`(`verified_by_user_id`, `verified_at`),
  CONSTRAINT `portal_contact_verifications_account_fk`
    FOREIGN KEY (`portal_account_id`) REFERENCES `portal_accounts`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `portal_contact_verifications_actor_fk`
    FOREIGN KEY (`verified_by_user_id`) REFERENCES `users`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
