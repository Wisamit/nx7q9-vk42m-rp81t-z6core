-- Separate high-risk scope for cancelling not-yet-effective configuration.
-- Never grant automatically to admins or ordinary reviewers.
INSERT INTO permissions (id, code, module, description, created_at)
SELECT UUID(), 'catalog.configuration.reverse', 'catalog',
  'Cancel approved future-effective configuration under signed journal and MFA signer safeguards',
  CURRENT_TIMESTAMP(3)
WHERE NOT EXISTS (
  SELECT 1 FROM permissions WHERE code='catalog.configuration.reverse'
);
