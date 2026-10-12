-- Stage 87: append-only lineage for approved reusable clinical comment texts.
-- Existing templates stay at revision 1 with NULL predecessor; no clinical
-- text, existing status, result, or issued report data is rewritten.
ALTER TABLE `result_comment_templates`
  ADD COLUMN `revision_number` INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN `supersedes_template_id` CHAR(36) NULL;

-- A template can have at most one direct successor, preventing a fork even
-- under concurrent import/review transactions.
CREATE UNIQUE INDEX `result_comment_templates_supersedes_template_id_key`
  ON `result_comment_templates`(`supersedes_template_id`);

ALTER TABLE `result_comment_templates`
  ADD CONSTRAINT `result_comment_templates_supersedes_template_id_fkey`
  FOREIGN KEY (`supersedes_template_id`)
  REFERENCES `result_comment_templates`(`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE;
