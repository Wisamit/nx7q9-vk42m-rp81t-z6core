-- Stage 3 / Part 5: branch-aware validation paths.
ALTER TABLE `result_validation_policies`
  ADD COLUMN `branch_id` CHAR(36) NULL AFTER `scope`,
  ADD INDEX `result_validation_policy_branch_idx` (`branch_id`, `scope`, `status`, `effective_from`),
  ADD CONSTRAINT `result_validation_policy_branch_fk`
    FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;
