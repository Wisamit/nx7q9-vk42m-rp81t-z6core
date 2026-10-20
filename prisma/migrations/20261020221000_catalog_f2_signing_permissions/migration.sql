-- Explicit, least-privilege F2 signatory capabilities.
-- No default grants: even a system administrator is not automatically
-- qualified to attest clinical/financial configuration.
INSERT INTO permissions (id, code, module, description, created_at)
SELECT UUID(), 'catalog.configuration.clinical.sign', 'catalog',
  'Sign reviewed clinical configuration (requires MFA)', CURRENT_TIMESTAMP(3)
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code='catalog.configuration.clinical.sign');

INSERT INTO permissions (id, code, module, description, created_at)
SELECT UUID(), 'catalog.configuration.financial.sign', 'catalog',
  'Sign reviewed financial configuration (requires MFA)', CURRENT_TIMESTAMP(3)
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code='catalog.configuration.financial.sign');
