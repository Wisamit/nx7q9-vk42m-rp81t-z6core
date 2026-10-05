ALTER TABLE `microbiology_isolates`
  ADD COLUMN `organism_code_snapshot` VARCHAR(80) NULL AFTER `organism_id`,
  ADD COLUMN `organism_name_en_snapshot` VARCHAR(220) NULL AFTER `organism_code_snapshot`,
  ADD COLUMN `organism_name_ar_snapshot` VARCHAR(220) NULL AFTER `organism_name_en_snapshot`;

UPDATE `microbiology_isolates` i
JOIN `organisms` o ON o.`id` = i.`organism_id`
SET i.`organism_code_snapshot` = o.`code`,
    i.`organism_name_en_snapshot` = o.`name_en`,
    i.`organism_name_ar_snapshot` = o.`name_ar`;

ALTER TABLE `microbiology_isolates`
  MODIFY `organism_code_snapshot` VARCHAR(80) NOT NULL,
  MODIFY `organism_name_en_snapshot` VARCHAR(220) NOT NULL;
