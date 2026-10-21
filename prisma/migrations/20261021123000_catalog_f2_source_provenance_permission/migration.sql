-- A provenance verifier is independent of the source importer and
-- cannot acquire this permission merely by being a catalog administrator.
INSERT INTO permissions (id,code,module,description,created_at)
SELECT UUID(),'catalog.configuration.source_provenance.verify','catalog',
       'Verify independently signed original installation and complete UUID mapping',CURRENT_TIMESTAMP(3)
WHERE NOT EXISTS (
  SELECT 1 FROM permissions
  WHERE code='catalog.configuration.source_provenance.verify'
);
