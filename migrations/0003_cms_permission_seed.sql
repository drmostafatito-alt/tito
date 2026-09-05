-- Phase 3: grant the admin role the full CMS permission set (system config, not content).
-- Idempotent: role_permissions_pk unique index + INSERT OR IGNORE. super_admin (rank 4) bypasses in code.
INSERT OR IGNORE INTO `role_permissions` (`role_id`, `permission`, `granted_at`) VALUES
  ('admin', 'cms.read', (strftime('%s','now') * 1000)),
  ('admin', 'cms.create', (strftime('%s','now') * 1000)),
  ('admin', 'cms.edit', (strftime('%s','now') * 1000)),
  ('admin', 'cms.publish', (strftime('%s','now') * 1000)),
  ('admin', 'cms.delete', (strftime('%s','now') * 1000)),
  ('admin', 'cms.manage_theme', (strftime('%s','now') * 1000)),
  ('admin', 'cms.manage_navigation', (strftime('%s','now') * 1000)),
  ('admin', 'cms.manage_forms', (strftime('%s','now') * 1000)),
  ('admin', 'cms.manage_seo', (strftime('%s','now') * 1000));
