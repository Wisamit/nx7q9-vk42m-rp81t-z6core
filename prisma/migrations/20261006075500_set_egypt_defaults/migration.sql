ALTER TABLE `organizations`
  MODIFY `default_currency` CHAR(3) NOT NULL DEFAULT 'EGP',
  MODIFY `default_timezone` VARCHAR(64) NOT NULL DEFAULT 'Africa/Cairo';

ALTER TABLE `branches`
  MODIFY `default_currency` CHAR(3) NOT NULL DEFAULT 'EGP',
  MODIFY `timezone` VARCHAR(64) NOT NULL DEFAULT 'Africa/Cairo';

UPDATE `organizations`
SET `default_currency` = 'EGP'
WHERE `code` = 'FAMILY_LAB'
  AND `default_currency` = 'AED';

UPDATE `organizations`
SET `default_timezone` = 'Africa/Cairo'
WHERE `code` = 'FAMILY_LAB'
  AND `default_timezone` = 'Asia/Dubai';

UPDATE `branches` b
JOIN `organizations` o ON o.`id` = b.`organization_id`
SET b.`default_currency` = 'EGP'
WHERE o.`code` = 'FAMILY_LAB'
  AND b.`default_currency` = 'AED';

UPDATE `branches` b
JOIN `organizations` o ON o.`id` = b.`organization_id`
SET b.`timezone` = 'Africa/Cairo'
WHERE o.`code` = 'FAMILY_LAB'
  AND b.`timezone` = 'Asia/Dubai';

ALTER TABLE `organization_settings`
  DROP COLUMN `developer_credit`;
