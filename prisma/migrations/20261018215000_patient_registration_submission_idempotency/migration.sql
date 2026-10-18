-- Stage 151: preserve all historical patients and make new keyed registrations unique
-- per organization and submitting staff account; NULL retains legacy API behavior.
ALTER TABLE `patients`
  ADD COLUMN `creation_request_user_id` CHAR(36) NULL,
  ADD COLUMN `creation_submission_key` CHAR(36) NULL,
  ADD COLUMN `creation_payload_hash` CHAR(64) NULL,
  ADD UNIQUE INDEX `patient_creation_request_key_uq`
    (`organization_id`, `creation_request_user_id`, `creation_submission_key`),
  ADD CONSTRAINT `patients_creation_request_user_fk`
    FOREIGN KEY (`creation_request_user_id`) REFERENCES `users`(`id`)
    ON UPDATE CASCADE ON DELETE RESTRICT;
