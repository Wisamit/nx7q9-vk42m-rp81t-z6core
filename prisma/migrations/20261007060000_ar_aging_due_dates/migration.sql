-- Phase 4F: historical invoice due-date snapshots for accounts receivable aging.

ALTER TABLE `invoices`
  ADD COLUMN `payment_terms_days_snapshot` INT NULL AFTER `balance_amount`,
  ADD COLUMN `due_date` DATE NULL AFTER `payment_terms_days_snapshot`,
  ADD COLUMN `due_date_basis` ENUM('ISSUANCE_SNAPSHOT','MIGRATED_BASELINE') NULL AFTER `due_date`;

UPDATE `invoices` i
LEFT JOIN `clients` c ON c.`id` = i.`client_id`
SET
  i.`payment_terms_days_snapshot` = COALESCE(c.`payment_terms_days`, 0),
  i.`due_date` = DATE_ADD(DATE(i.`issued_at`), INTERVAL COALESCE(c.`payment_terms_days`, 0) DAY),
  i.`due_date_basis` = 'MIGRATED_BASELINE'
WHERE i.`client_id` IS NOT NULL
  AND i.`due_date` IS NULL;

ALTER TABLE `invoices`
  ADD INDEX `invoices_client_currency_due_date_idx`(`client_id`, `currency`, `due_date`);
