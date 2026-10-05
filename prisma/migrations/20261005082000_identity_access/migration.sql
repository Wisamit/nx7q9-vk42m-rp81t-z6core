ALTER TABLE `users`
  ADD COLUMN `failed_login_attempts` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `locked_until` DATETIME(3) NULL,
  ADD COLUMN `password_changed_at` DATETIME(3) NULL;

CREATE TABLE `user_sessions` (
  `id` CHAR(36) NOT NULL,
  `user_id` CHAR(36) NOT NULL,
  `active_branch_id` CHAR(36) NULL,
  `token_hash` CHAR(64) NOT NULL,
  `expires_at` DATETIME(3) NOT NULL,
  `revoked_at` DATETIME(3) NULL,
  `last_seen_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `ip_address` VARCHAR(45) NULL,
  `user_agent` VARCHAR(500) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `user_sessions_token_hash_key`(`token_hash`),
  INDEX `user_sessions_user_id_expires_at_idx`(`user_id`, `expires_at`),
  INDEX `user_sessions_active_branch_id_idx`(`active_branch_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `user_sessions`
  ADD CONSTRAINT `user_sessions_user_id_fkey`
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `user_sessions`
  ADD CONSTRAINT `user_sessions_active_branch_id_fkey`
  FOREIGN KEY (`active_branch_id`) REFERENCES `branches`(`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE;
