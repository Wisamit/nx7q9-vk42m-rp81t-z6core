INSERT INTO `permissions` (`id`,`code`,`module`,`description`,`created_at`) VALUES
(UUID(),'catalog.view','catalog','View test catalog',CURRENT_TIMESTAMP(3)),
(UUID(),'catalog.manage','catalog','Manage test catalog',CURRENT_TIMESTAMP(3)),
(UUID(),'catalog.reference_ranges.manage','catalog','Manage reference intervals and critical limits',CURRENT_TIMESTAMP(3));

INSERT INTO `role_permissions` (`role_id`,`permission_id`,`granted_at`)
SELECT r.id,p.id,CURRENT_TIMESTAMP(3)
FROM `roles` r CROSS JOIN `permissions` p
WHERE r.code='SYSTEM_ADMIN' AND p.code IN ('catalog.view','catalog.manage','catalog.reference_ranges.manage')
AND NOT EXISTS (SELECT 1 FROM `role_permissions` rp WHERE rp.role_id=r.id AND rp.permission_id=p.id);
