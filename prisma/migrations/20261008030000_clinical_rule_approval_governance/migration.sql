-- Stage 3 / Part 8: approval governance for advanced clinical rules.
-- Existing ACTIVE rules remain active as a migration baseline to avoid silently removing
-- delta, hold, escalation, calculation or validation safeguards already in service.
-- New rules become INACTIVE drafts and require explicit approval through the governed API.

UPDATE `calculated_result_rules`
SET `deactivated_at` = COALESCE(`deactivated_at`, CURRENT_TIMESTAMP(3))
WHERE `status` = 'INACTIVE' AND `deactivated_at` IS NULL;

UPDATE `reflex_rules`
SET `deactivated_at` = COALESCE(`deactivated_at`, CURRENT_TIMESTAMP(3))
WHERE `status` = 'INACTIVE' AND `deactivated_at` IS NULL;

UPDATE `delta_rules`
SET `deactivated_at` = COALESCE(`deactivated_at`, CURRENT_TIMESTAMP(3))
WHERE `status` = 'INACTIVE' AND `deactivated_at` IS NULL;

UPDATE `autoverification_policies`
SET `deactivated_at` = COALESCE(`deactivated_at`, CURRENT_TIMESTAMP(3))
WHERE `status` = 'INACTIVE' AND `deactivated_at` IS NULL;

UPDATE `validation_hold_rules`
SET `deactivated_at` = COALESCE(`deactivated_at`, CURRENT_TIMESTAMP(3))
WHERE `status` = 'INACTIVE' AND `deactivated_at` IS NULL;

UPDATE `critical_escalation_policies`
SET `deactivated_at` = COALESCE(`deactivated_at`, CURRENT_TIMESTAMP(3))
WHERE `status` = 'INACTIVE' AND `deactivated_at` IS NULL;

UPDATE `result_validation_policies`
SET `deactivated_at` = COALESCE(`deactivated_at`, CURRENT_TIMESTAMP(3))
WHERE `status` = 'INACTIVE' AND `deactivated_at` IS NULL;

ALTER TABLE `calculated_result_rules`
  MODIFY `status` ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'INACTIVE';

ALTER TABLE `reflex_rules`
  MODIFY `status` ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'INACTIVE';

ALTER TABLE `delta_rules`
  MODIFY `status` ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'INACTIVE';

ALTER TABLE `autoverification_policies`
  MODIFY `status` ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'INACTIVE';

ALTER TABLE `validation_hold_rules`
  MODIFY `status` ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'INACTIVE';

ALTER TABLE `critical_escalation_policies`
  MODIFY `status` ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'INACTIVE';

ALTER TABLE `result_validation_policies`
  MODIFY `status` ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'INACTIVE',
  DROP INDEX `result_validation_policies_org_code_key`,
  ADD INDEX `result_validation_policies_org_code_idx` (`organization_id`, `code`);

INSERT IGNORE INTO `permissions` (`id`,`code`,`module`,`description`,`created_at`) VALUES
(UUID(),'clinical_rules.approve','clinical_rules','Approve and retire advanced clinical rules and validation policies',CURRENT_TIMESTAMP(3));

INSERT IGNORE INTO `role_permissions` (`role_id`,`permission_id`,`granted_at`)
SELECT rp.role_id, p_new.id, CURRENT_TIMESTAMP(3)
FROM `role_permissions` rp
JOIN `permissions` p_old ON p_old.id = rp.permission_id AND p_old.code = 'clinical_rules.manage'
JOIN `permissions` p_new ON p_new.code = 'clinical_rules.approve';

INSERT IGNORE INTO `role_permissions` (`role_id`,`permission_id`,`granted_at`)
SELECT r.id, p.id, CURRENT_TIMESTAMP(3)
FROM `roles` r
JOIN `permissions` p ON p.code = 'clinical_rules.approve'
WHERE r.code = 'SYSTEM_ADMIN';

INSERT INTO `audit_events`
(`id`,`organization_id`,`action`,`entity_type`,`entity_id`,`new_values`,`reason`)
SELECT UUID(), `organization_id`, 'CLINICAL_RULE_LEGACY_BASELINE', 'CalculatedResultRule', `id`,
       JSON_OBJECT('status','ACTIVE','governance','LEGACY_BASELINE'),
       'Active rule retained during Stage 3 Part 8 governance migration'
FROM `calculated_result_rules` WHERE `status` = 'ACTIVE';

INSERT INTO `audit_events`
(`id`,`organization_id`,`action`,`entity_type`,`entity_id`,`new_values`,`reason`)
SELECT UUID(), `organization_id`, 'CLINICAL_RULE_LEGACY_BASELINE', 'ReflexRule', `id`,
       JSON_OBJECT('status','ACTIVE','governance','LEGACY_BASELINE'),
       'Active rule retained during Stage 3 Part 8 governance migration'
FROM `reflex_rules` WHERE `status` = 'ACTIVE';

INSERT INTO `audit_events`
(`id`,`organization_id`,`action`,`entity_type`,`entity_id`,`new_values`,`reason`)
SELECT UUID(), `organization_id`, 'CLINICAL_RULE_LEGACY_BASELINE', 'DeltaRule', `id`,
       JSON_OBJECT('status','ACTIVE','governance','LEGACY_BASELINE'),
       'Active rule retained during Stage 3 Part 8 governance migration'
FROM `delta_rules` WHERE `status` = 'ACTIVE';

INSERT INTO `audit_events`
(`id`,`organization_id`,`action`,`entity_type`,`entity_id`,`new_values`,`reason`)
SELECT UUID(), `organization_id`, 'CLINICAL_RULE_LEGACY_BASELINE', 'AutoverificationPolicy', `id`,
       JSON_OBJECT('status','ACTIVE','governance','LEGACY_BASELINE'),
       'Active rule retained during Stage 3 Part 8 governance migration'
FROM `autoverification_policies` WHERE `status` = 'ACTIVE';

INSERT INTO `audit_events`
(`id`,`organization_id`,`action`,`entity_type`,`entity_id`,`new_values`,`reason`)
SELECT UUID(), `organization_id`, 'CLINICAL_RULE_LEGACY_BASELINE', 'ValidationHoldRule', `id`,
       JSON_OBJECT('status','ACTIVE','governance','LEGACY_BASELINE'),
       'Active rule retained during Stage 3 Part 8 governance migration'
FROM `validation_hold_rules` WHERE `status` = 'ACTIVE';

INSERT INTO `audit_events`
(`id`,`organization_id`,`action`,`entity_type`,`entity_id`,`new_values`,`reason`)
SELECT UUID(), `organization_id`, 'CLINICAL_RULE_LEGACY_BASELINE', 'CriticalEscalationPolicy', `id`,
       JSON_OBJECT('status','ACTIVE','governance','LEGACY_BASELINE'),
       'Active rule retained during Stage 3 Part 8 governance migration'
FROM `critical_escalation_policies` WHERE `status` = 'ACTIVE';

INSERT INTO `audit_events`
(`id`,`organization_id`,`action`,`entity_type`,`entity_id`,`new_values`,`reason`)
SELECT UUID(), `organization_id`, 'CLINICAL_RULE_LEGACY_BASELINE', 'ResultValidationPolicy', `id`,
       JSON_OBJECT('status','ACTIVE','governance','LEGACY_BASELINE'),
       'Active rule retained during Stage 3 Part 8 governance migration'
FROM `result_validation_policies` WHERE `status` = 'ACTIVE';
