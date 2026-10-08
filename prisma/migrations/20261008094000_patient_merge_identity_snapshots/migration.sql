ALTER TABLE `patient_merge_events`
  ADD COLUMN `source_identity_snapshot` JSON NULL AFTER `target_patient_number_snapshot`,
  ADD COLUMN `target_identity_snapshot` JSON NULL AFTER `source_identity_snapshot`,
  ADD COLUMN `duplicate_evidence_snapshot` JSON NULL AFTER `target_identity_snapshot`;
