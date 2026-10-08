ALTER TABLE `orders`
  ADD COLUMN `patient_sex_snapshot` VARCHAR(10) NULL AFTER `patient_id`,
  ADD COLUMN `patient_dob_snapshot` DATE NULL AFTER `patient_sex_snapshot`,
  ADD COLUMN `patient_age_value_snapshot` INT NULL AFTER `patient_dob_snapshot`,
  ADD COLUMN `patient_age_unit_snapshot` VARCHAR(8) NULL AFTER `patient_age_value_snapshot`,
  ADD COLUMN `patient_age_recorded_at_snapshot` DATETIME(3) NULL AFTER `patient_age_unit_snapshot`;

-- Existing orders remain NULL: historic clinical demographics are not inferred from mutable patient master data.
