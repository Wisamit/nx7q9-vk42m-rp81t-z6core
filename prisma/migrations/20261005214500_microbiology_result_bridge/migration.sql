ALTER TABLE `laboratory_results`
  ADD COLUMN `microbiology_snapshot` JSON NULL AFTER `autoverification_decision_snapshot`;
