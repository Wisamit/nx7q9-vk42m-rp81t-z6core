-- Family Lab LIS - Phase 1 foundation
-- Multi-branch organization, identity/authorization and append-only audit foundation.

CREATE TABLE `organizations` (
  `id` CHAR(36) NOT NULL,
  `code` VARCHAR(50) NOT NULL,
  `name_en` VARCHAR(200) NOT NULL,
  `name_ar` VARCHAR(200) NULL,
  `legal_name` VARCHAR(255) NULL,
  `default_currency` CHAR(3) NOT NULL DEFAULT 'AED',
  `default_timezone` VARCHAR(64) NOT NULL DEFAULT 'Asia/Dubai',
  `status` ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  `deactivated_at` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `organizations_code_key`(`code`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `branches` (
  `id` CHAR(36) NOT NULL,
  `organization_id` CHAR(36) NOT NULL,
  `code` VARCHAR(50) NOT NULL,
  `name_en` VARCHAR(200) NOT NULL,
  `name_ar` VARCHAR(200) NULL,
  `timezone` VARCHAR(64) NOT NULL DEFAULT 'Asia/Dubai',
  `default_currency` CHAR(3) NOT NULL DEFAULT 'AED',
  `phone` VARCHAR(50) NULL,
  `email` VARCHAR(191) NULL,
  `address_en` TEXT NULL,
  `address_ar` TEXT NULL,
  `is_central_lab` BOOLEAN NOT NULL DEFAULT false,
  `status` ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  `deactivated_at` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `branches_organization_id_code_key`(`organization_id`, `code`),
  INDEX `branches_organization_id_status_idx`(`organization_id`, `status`),
  CONSTRAINT `branches_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `branch_settings` (
  `id` CHAR(36) NOT NULL,
  `branch_id` CHAR(36) NOT NULL,
  `key` VARCHAR(100) NOT NULL,
  `value` JSON NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `branch_settings_branch_id_key_key`(`branch_id`, `key`),
  CONSTRAINT `branch_settings_branch_id_fkey` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `departments` (
  `id` CHAR(36) NOT NULL,
  `organization_id` CHAR(36) NOT NULL,
  `branch_id` CHAR(36) NULL,
  `code` VARCHAR(50) NOT NULL,
  `name_en` VARCHAR(150) NOT NULL,
  `name_ar` VARCHAR(150) NULL,
  `status` ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  `deactivated_at` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `departments_organization_id_code_key`(`organization_id`, `code`),
  INDEX `departments_organization_id_status_idx`(`organization_id`, `status`),
  INDEX `departments_branch_id_status_idx`(`branch_id`, `status`),
  CONSTRAINT `departments_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `departments_branch_id_fkey` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `workstations` (
  `id` CHAR(36) NOT NULL,
  `branch_id` CHAR(36) NOT NULL,
  `department_id` CHAR(36) NULL,
  `code` VARCHAR(50) NOT NULL,
  `name_en` VARCHAR(150) NOT NULL,
  `name_ar` VARCHAR(150) NULL,
  `status` ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  `deactivated_at` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `workstations_branch_id_code_key`(`branch_id`, `code`),
  INDEX `workstations_department_id_status_idx`(`department_id`, `status`),
  CONSTRAINT `workstations_branch_id_fkey` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `workstations_department_id_fkey` FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `users` (
  `id` CHAR(36) NOT NULL,
  `organization_id` CHAR(36) NOT NULL,
  `username` VARCHAR(100) NOT NULL,
  `email` VARCHAR(191) NULL,
  `password_hash` VARCHAR(255) NULL,
  `display_name_en` VARCHAR(200) NOT NULL,
  `display_name_ar` VARCHAR(200) NULL,
  `preferred_locale` VARCHAR(10) NOT NULL DEFAULT 'en',
  `status` ENUM('INVITED','ACTIVE','SUSPENDED','DISABLED') NOT NULL DEFAULT 'INVITED',
  `last_login_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  `deactivated_at` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `users_organization_id_username_key`(`organization_id`, `username`),
  UNIQUE INDEX `users_organization_id_email_key`(`organization_id`, `email`),
  INDEX `users_organization_id_status_idx`(`organization_id`, `status`),
  CONSTRAINT `users_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `roles` (
  `id` CHAR(36) NOT NULL,
  `organization_id` CHAR(36) NOT NULL,
  `code` VARCHAR(80) NOT NULL,
  `name_en` VARCHAR(150) NOT NULL,
  `name_ar` VARCHAR(150) NULL,
  `is_system` BOOLEAN NOT NULL DEFAULT false,
  `status` ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  `deactivated_at` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `roles_organization_id_code_key`(`organization_id`, `code`),
  CONSTRAINT `roles_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `permissions` (
  `id` CHAR(36) NOT NULL,
  `code` VARCHAR(120) NOT NULL,
  `module` VARCHAR(80) NOT NULL,
  `description` VARCHAR(255) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `permissions_code_key`(`code`),
  INDEX `permissions_module_idx`(`module`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `user_roles` (
  `user_id` CHAR(36) NOT NULL,
  `role_id` CHAR(36) NOT NULL,
  `assigned_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `assigned_by` CHAR(36) NULL,
  PRIMARY KEY (`user_id`, `role_id`),
  INDEX `user_roles_role_id_idx`(`role_id`),
  CONSTRAINT `user_roles_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `user_roles_role_id_fkey` FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `role_permissions` (
  `role_id` CHAR(36) NOT NULL,
  `permission_id` CHAR(36) NOT NULL,
  `granted_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`role_id`, `permission_id`),
  INDEX `role_permissions_permission_id_idx`(`permission_id`),
  CONSTRAINT `role_permissions_role_id_fkey` FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `role_permissions_permission_id_fkey` FOREIGN KEY (`permission_id`) REFERENCES `permissions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `user_branch_scopes` (
  `user_id` CHAR(36) NOT NULL,
  `branch_id` CHAR(36) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`user_id`, `branch_id`),
  INDEX `user_branch_scopes_branch_id_idx`(`branch_id`),
  CONSTRAINT `user_branch_scopes_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `user_branch_scopes_branch_id_fkey` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `user_department_scopes` (
  `user_id` CHAR(36) NOT NULL,
  `department_id` CHAR(36) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`user_id`, `department_id`),
  INDEX `user_department_scopes_department_id_idx`(`department_id`),
  CONSTRAINT `user_department_scopes_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `user_department_scopes_department_id_fkey` FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `audit_events` (
  `id` CHAR(36) NOT NULL,
  `organization_id` CHAR(36) NOT NULL,
  `branch_id` CHAR(36) NULL,
  `actor_user_id` CHAR(36) NULL,
  `action` VARCHAR(100) NOT NULL,
  `entity_type` VARCHAR(100) NOT NULL,
  `entity_id` VARCHAR(100) NOT NULL,
  `old_values` JSON NULL,
  `new_values` JSON NULL,
  `reason` TEXT NULL,
  `request_id` VARCHAR(100) NULL,
  `session_id` VARCHAR(100) NULL,
  `ip_address` VARCHAR(45) NULL,
  `user_agent` VARCHAR(500) NULL,
  `occurred_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `audit_events_organization_id_occurred_at_idx`(`organization_id`, `occurred_at`),
  INDEX `audit_events_branch_id_occurred_at_idx`(`branch_id`, `occurred_at`),
  INDEX `audit_events_actor_user_id_occurred_at_idx`(`actor_user_id`, `occurred_at`),
  INDEX `audit_events_entity_type_entity_id_occurred_at_idx`(`entity_type`, `entity_id`, `occurred_at`),
  CONSTRAINT `audit_events_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `audit_events_branch_id_fkey` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `audit_events_actor_user_id_fkey` FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
