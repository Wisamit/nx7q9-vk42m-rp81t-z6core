-- Stage 3 / Part 9: version-safe report presentation rules.
ALTER TABLE `test_components`
  ADD COLUMN `report_name_en` VARCHAR(200) NULL AFTER `result_section_id`,
  ADD COLUMN `report_name_ar` VARCHAR(200) NULL AFTER `report_name_en`,
  ADD COLUMN `report_display_order` INT NULL AFTER `report_name_ar`,
  ADD COLUMN `report_visible` BOOLEAN NOT NULL DEFAULT TRUE AFTER `report_display_order`;

ALTER TABLE `test_result_sections`
  ADD COLUMN `report_display_order` INT NULL AFTER `display_order`,
  ADD COLUMN `report_visible` BOOLEAN NOT NULL DEFAULT TRUE AFTER `report_display_order`;

ALTER TABLE `laboratory_result_values`
  ADD COLUMN `report_name_en_snapshot` VARCHAR(220) NULL AFTER `component_name_ar_snapshot`,
  ADD COLUMN `report_name_ar_snapshot` VARCHAR(220) NULL AFTER `report_name_en_snapshot`,
  ADD COLUMN `report_display_order_snapshot` INT NULL AFTER `report_name_ar_snapshot`,
  ADD COLUMN `report_visible_snapshot` BOOLEAN NULL AFTER `report_display_order_snapshot`,
  ADD COLUMN `report_section_code_snapshot` VARCHAR(80) NULL AFTER `report_visible_snapshot`,
  ADD COLUMN `report_section_name_en_snapshot` VARCHAR(220) NULL AFTER `report_section_code_snapshot`,
  ADD COLUMN `report_section_name_ar_snapshot` VARCHAR(220) NULL AFTER `report_section_name_en_snapshot`,
  ADD COLUMN `report_section_order_snapshot` INT NULL AFTER `report_section_name_ar_snapshot`;

-- Existing result rows are intentionally not backfilled from today's catalog.
-- NULL presentation snapshots preserve the legacy rendering path and avoid
-- rewriting historical report semantics with current configuration.
