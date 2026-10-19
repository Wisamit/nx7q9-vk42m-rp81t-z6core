-- Release closure: reject stale organization-settings writes across concurrent sessions.
-- Additive version counter; existing settings start at revision 0.
ALTER TABLE organizations
  ADD COLUMN settings_revision INT NOT NULL DEFAULT 0;
