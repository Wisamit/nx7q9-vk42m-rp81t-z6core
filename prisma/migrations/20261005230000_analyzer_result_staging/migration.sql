ALTER TABLE `analyzer_result_imports`
  ADD COLUMN `bridge_observation_id` VARCHAR(150) NOT NULL AFTER `message_id`,
  ADD COLUMN `error_code` VARCHAR(120) NULL AFTER `status`,
  ADD UNIQUE INDEX `analyzer_result_imports_message_observation_key`(`message_id`,`bridge_observation_id`);
