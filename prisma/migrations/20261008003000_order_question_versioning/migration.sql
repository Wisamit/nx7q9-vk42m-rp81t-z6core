-- Stage 3 / Part 4: effective-dated ask-at-order definitions and richer answer snapshots.
-- Existing question records become version 1 effective from their original creation time.

ALTER TABLE `order_questions`
  MODIFY `response_type` ENUM('TEXT','NUMERIC','BOOLEAN','DATE','DATETIME','SINGLE_CHOICE') NOT NULL,
  ADD COLUMN `version` INTEGER NOT NULL DEFAULT 1 AFTER `display_order`,
  ADD COLUMN `effective_from` DATETIME(3) NULL AFTER `version`,
  ADD COLUMN `effective_to` DATETIME(3) NULL AFTER `effective_from`,
  ADD COLUMN `supersedes_question_id` CHAR(36) NULL AFTER `effective_to`;

UPDATE `order_questions`
SET `effective_from` = `created_at`
WHERE `effective_from` IS NULL;

ALTER TABLE `order_questions`
  MODIFY `effective_from` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  DROP INDEX `order_questions_test_id_code_key`,
  ADD UNIQUE INDEX `order_questions_test_id_code_version_key` (`test_id`, `code`, `version`),
  ADD INDEX `order_questions_test_code_effective_idx` (`test_id`, `code`, `status`, `effective_from`, `effective_to`),
  ADD INDEX `order_questions_supersedes_question_id_idx` (`supersedes_question_id`),
  ADD CONSTRAINT `order_questions_supersedes_question_id_fkey`
    FOREIGN KEY (`supersedes_question_id`) REFERENCES `order_questions`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `order_answers`
  MODIFY `response_type_snapshot` ENUM('TEXT','NUMERIC','BOOLEAN','DATE','DATETIME','SINGLE_CHOICE') NOT NULL,
  ADD COLUMN `question_version_snapshot` INTEGER NOT NULL DEFAULT 1 AFTER `response_type_snapshot`,
  ADD COLUMN `answer_date_time` DATETIME(3) NULL AFTER `answer_date`,
  ADD COLUMN `selected_option_code_snapshot` VARCHAR(100) NULL AFTER `selected_option_snapshot`,
  ADD COLUMN `selected_option_text_en_snapshot` VARCHAR(500) NULL AFTER `selected_option_code_snapshot`,
  ADD COLUMN `selected_option_text_ar_snapshot` VARCHAR(500) NULL AFTER `selected_option_text_en_snapshot`;
