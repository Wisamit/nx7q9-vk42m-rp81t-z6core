-- Stage 96: MFA-aware short-lived, single-use high-risk approval evidence.
CREATE TABLE `staff_step_up_grants` (
  `id` CHAR(36) NOT NULL,
  `user_id` CHAR(36) NOT NULL,
  `session_id` CHAR(36) NOT NULL,
  `organization_id` CHAR(36) NOT NULL,
  `branch_id` CHAR(36) NOT NULL,
  `action` VARCHAR(40) NOT NULL,
  `resource_key` VARCHAR(150) NOT NULL,
  `token_hash` CHAR(64) NOT NULL,
  `proof_method` VARCHAR(40) NOT NULL,
  `expires_at` DATETIME(3) NOT NULL,
  `consumed_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `staff_step_up_grants_token_hash_key`(`token_hash`),
  INDEX `ssug_session_created_idx` (`session_id`,`created_at`),
  INDEX `ssug_scope_expiry_idx` (`organization_id`,`branch_id`,`action`,`expires_at`),
  INDEX `ssug_user_fk_idx` (`user_id`),
  CONSTRAINT `ssug_user_fk` FOREIGN KEY(`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `ssug_session_fk` FOREIGN KEY(`session_id`) REFERENCES `user_sessions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE `staff_step_up_attempts` (
  `id` CHAR(36) NOT NULL,
  `user_id` CHAR(36) NOT NULL,
  `session_id` CHAR(36) NOT NULL,
  `success` BOOLEAN NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `ssua_user_window_idx` (`user_id`,`created_at`,`success`),
  INDEX `ssua_session_fk_idx` (`session_id`),
  CONSTRAINT `ssua_user_fk` FOREIGN KEY(`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `ssua_session_fk` FOREIGN KEY(`session_id`) REFERENCES `user_sessions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
