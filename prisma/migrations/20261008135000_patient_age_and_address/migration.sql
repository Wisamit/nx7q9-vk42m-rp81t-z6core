ALTER TABLE `patients`
  ADD COLUMN `recorded_age_value` INT NULL AFTER `date_of_birth`,
  ADD COLUMN `recorded_age_unit` VARCHAR(8) NULL AFTER `recorded_age_value`,
  ADD COLUMN `recorded_age_at` DATETIME(3) NULL AFTER `recorded_age_unit`,
  ADD COLUMN `address` TEXT NULL AFTER `address_ar`;

-- Historical addresses are preserved in existing language-specific fields.
-- Historical ages are left NULL: no age/date is fabricated.
