ALTER TABLE `organizations`
  MODIFY `default_currency` CHAR(3) NOT NULL DEFAULT 'EGP',
  MODIFY `default_timezone` VARCHAR(64) NOT NULL DEFAULT 'Africa/Cairo';

UPDATE `organizations`
SET `default_currency` = 'EGP'
WHERE `code` = 'FAMILY_LAB'
  AND `default_currency` = 'AED';

UPDATE `organizations`
SET `default_timezone` = 'Africa/Cairo'
WHERE `code` = 'FAMILY_LAB'
  AND `default_timezone` = 'Asia/Dubai';
