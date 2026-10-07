ALTER TABLE `portal_accounts`
  ADD COLUMN `email_verified_at` DATETIME(3) NULL AFTER `contact_verified_at`,
  ADD COLUMN `phone_verified_at` DATETIME(3) NULL AFTER `email_verified_at`;
