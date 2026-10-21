-- Explicit operator capability. Do not automatically grant to SYSTEM_ADMIN
-- or either qualified clinical/financial signing role.
INSERT INTO permissions(id,code,module,description,created_at)
SELECT UUID(),'catalog.configuration.apply','catalog',
       'Execute a fully signed future-effective configuration apply',CURRENT_TIMESTAMP(3)
WHERE NOT EXISTS(
  SELECT 1 FROM permissions WHERE code='catalog.configuration.apply'
);
