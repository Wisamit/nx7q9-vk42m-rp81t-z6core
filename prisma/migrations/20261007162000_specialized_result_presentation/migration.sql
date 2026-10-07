ALTER TABLE `test_components`
  ADD COLUMN `entry_width` ENUM('AUTO','NARROW','STANDARD','WIDE','FULL') NOT NULL DEFAULT 'AUTO' AFTER `result_section_id`,
  ADD COLUMN `entry_hint_en` VARCHAR(500) NULL AFTER `entry_width`,
  ADD COLUMN `entry_hint_ar` VARCHAR(500) NULL AFTER `entry_hint_en`;

ALTER TABLE `test_result_sections`
  ADD COLUMN `column_count` INT NOT NULL DEFAULT 3 AFTER `display_order`,
  ADD COLUMN `hint_en` VARCHAR(500) NULL AFTER `column_count`,
  ADD COLUMN `hint_ar` VARCHAR(500) NULL AFTER `hint_en`;
