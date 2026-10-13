-- Historical orders remain without a delivery promise. Never infer a patient
-- commitment retrospectively from a mutable TAT policy.
ALTER TABLE `orders`
  ADD COLUMN `promised_report_delivery_at_utc` DATETIME(3) NULL,
  ADD COLUMN `promised_report_delivery_local` VARCHAR(16) NULL,
  ADD COLUMN `promised_report_delivery_timezone` VARCHAR(64) NULL;
