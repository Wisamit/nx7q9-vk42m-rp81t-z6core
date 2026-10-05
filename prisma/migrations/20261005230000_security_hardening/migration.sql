ALTER TABLE `users`
  ADD COLUMN `mfa_enabled` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `mfa_secret_encrypted` VARCHAR(700) NULL,
  ADD COLUMN `mfa_pending_secret_encrypted` VARCHAR(700) NULL,
  ADD COLUMN `mfa_confirmed_at` DATETIME(3) NULL,
  ADD COLUMN `mfa_recovery_codes` JSON NULL;

CREATE TABLE `staff_mfa_challenges` (
  `id` CHAR(36) NOT NULL,
  `user_id` CHAR(36) NOT NULL,
  `token_hash` CHAR(64) NOT NULL,
  `expires_at` DATETIME(3) NOT NULL,
  `consumed_at` DATETIME(3) NULL,
  `ip_address` VARCHAR(45) NULL,
  `user_agent` VARCHAR(500) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `staff_mfa_challenges_token_hash_key`(`token_hash`),
  INDEX `staff_mfa_challenges_user_id_expires_at_consumed_at_idx`(`user_id`, `expires_at`, `consumed_at`),
  PRIMARY KEY (`id`),
  CONSTRAINT `staff_mfa_challenges_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `request_rate_limits` (
  `id` CHAR(36) NOT NULL,
  `scope` VARCHAR(80) NOT NULL,
  `key_hash` CHAR(64) NOT NULL,
  `window_start` DATETIME(3) NOT NULL,
  `count` INTEGER NOT NULL DEFAULT 0,
  `updated_at` DATETIME(3) NOT NULL,

  UNIQUE INDEX `request_rate_limits_scope_key_hash_key`(`scope`, `key_hash`),
  INDEX `request_rate_limits_updated_at_idx`(`updated_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
