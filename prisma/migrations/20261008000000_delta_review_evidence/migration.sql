-- Stage 3 / Part 3: persistent delta review evidence.
-- Existing result values keep their historical numeric delta snapshots. New rule linkage is nullable for pre-migration data.
ALTER TABLE `laboratory_result_values`
  ADD COLUMN `delta_rule_id` CHAR(36) NULL AFTER `delta_percent_limit_snapshot`,
  ADD COLUMN `delta_lookback_days_snapshot` INTEGER NULL AFTER `delta_rule_id`,
  ADD INDEX `laboratory_result_values_delta_rule_id_idx` (`delta_rule_id`),
  ADD CONSTRAINT `laboratory_result_values_delta_rule_fkey`
    FOREIGN KEY (`delta_rule_id`) REFERENCES `delta_rules`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE `delta_review_events` (
  `id` CHAR(36) NOT NULL,
  `result_id` CHAR(36) NOT NULL,
  `delta_rule_id` CHAR(36) NULL,
  `status` ENUM('PENDING','ACKNOWLEDGED','SUPERSEDED') NOT NULL DEFAULT 'PENDING',
  `component_code_snapshot` VARCHAR(80) NOT NULL,
  `component_name_en_snapshot` VARCHAR(220) NOT NULL,
  `component_name_ar_snapshot` VARCHAR(220) NULL,
  `current_value_snapshot` DECIMAL(24,8) NOT NULL,
  `previous_value_snapshot` DECIMAL(24,8) NULL,
  `previous_result_at_snapshot` DATETIME(3) NULL,
  `delta_absolute_snapshot` DECIMAL(24,8) NULL,
  `delta_percent_snapshot` DECIMAL(18,6) NULL,
  `absolute_limit_snapshot` DECIMAL(24,8) NULL,
  `percent_limit_snapshot` DECIMAL(18,6) NULL,
  `lookback_days_snapshot` INTEGER NULL,
  `performing_branch_id_snapshot` CHAR(36) NOT NULL,
  `method_id_snapshot` CHAR(36) NULL,
  `detected_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `acknowledged_by_user_id` CHAR(36) NULL,
  `acknowledged_at` DATETIME(3) NULL,
  `acknowledgement_note` VARCHAR(1000) NULL,
  `superseded_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `delta_review_events_result_component_key` (`result_id`, `component_code_snapshot`),
  INDEX `delta_review_events_status_detected_idx` (`status`, `detected_at`),
  INDEX `delta_review_events_rule_idx` (`delta_rule_id`),
  INDEX `delta_review_events_ack_actor_idx` (`acknowledged_by_user_id`, `acknowledged_at`),
  CONSTRAINT `delta_review_events_result_fkey`
    FOREIGN KEY (`result_id`) REFERENCES `laboratory_results`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `delta_review_events_rule_fkey`
    FOREIGN KEY (`delta_rule_id`) REFERENCES `delta_rules`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `delta_review_events_ack_actor_fkey`
    FOREIGN KEY (`acknowledged_by_user_id`) REFERENCES `users`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
