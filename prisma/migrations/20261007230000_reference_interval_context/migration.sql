-- Stage 3 / Part 1: contextual reference intervals.
-- Existing orders remain UNKNOWN/null for new clinical context fields; no historical context is inferred.
ALTER TABLE `orders`
  ADD COLUMN `pregnancy_status` ENUM('UNKNOWN','NOT_PREGNANT','PREGNANT') NOT NULL DEFAULT 'UNKNOWN' AFTER `pregnancy_info`,
  ADD COLUMN `gestational_age_weeks` DECIMAL(6,2) NULL AFTER `pregnancy_status`,
  ADD COLUMN `reference_population_code` VARCHAR(80) NULL AFTER `gestational_age_weeks`;

ALTER TABLE `reference_intervals`
  ADD COLUMN `analyzer_id` CHAR(36) NULL AFTER `method_id`,
  ADD COLUMN `specimen_type_id` CHAR(36) NULL AFTER `analyzer_id`,
  ADD COLUMN `pregnancy_status` ENUM('UNKNOWN','NOT_PREGNANT','PREGNANT') NULL AFTER `age_unit`,
  ADD COLUMN `gestational_age_from_weeks` DECIMAL(6,2) NULL AFTER `pregnancy_status`,
  ADD COLUMN `gestational_age_to_weeks` DECIMAL(6,2) NULL AFTER `gestational_age_from_weeks`,
  ADD COLUMN `population_code` VARCHAR(80) NULL AFTER `gestational_age_to_weeks`,
  ADD INDEX `reference_intervals_analyzer_status_idx` (`analyzer_id`, `status`),
  ADD INDEX `reference_intervals_specimen_status_idx` (`specimen_type_id`, `status`),
  ADD INDEX `reference_intervals_population_status_idx` (`population_code`, `status`),
  ADD CONSTRAINT `reference_intervals_analyzer_fkey`
    FOREIGN KEY (`analyzer_id`) REFERENCES `analyzers`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `reference_intervals_specimen_type_fkey`
    FOREIGN KEY (`specimen_type_id`) REFERENCES `specimen_types`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;
