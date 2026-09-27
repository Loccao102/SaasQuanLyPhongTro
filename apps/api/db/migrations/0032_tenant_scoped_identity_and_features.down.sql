BEGIN;

DELETE FROM system_settings WHERE key = 'google_auth_enabled';

UPDATE saas_plan_versions
SET features = COALESCE(features, '{}'::jsonb)
  - ARRAY[
      'properties',
      'leases',
      'metering',
      'billing',
      'payments',
      'maintenance',
      'notifications',
      'reports',
      'team_management'
    ]::text[];

ALTER TABLE organization_entitlement_overrides
  DROP CONSTRAINT IF EXISTS organization_entitlement_overrides_entitlement_key_check;

ALTER TABLE organization_entitlement_overrides
  ADD CONSTRAINT organization_entitlement_overrides_entitlement_key_check
  CHECK (entitlement_key IN (
    'room_limit',
    'staff_limit',
    'automation_actions_monthly',
    'advanced_reports',
    'audit_log'
  ));

DROP TABLE IF EXISTS user_auth_identities;

DROP INDEX IF EXISTS auth_sessions_org_user_active_idx;
ALTER TABLE auth_sessions
  DROP COLUMN IF EXISTS organization_id;

ALTER TABLE organization_memberships
  DROP CONSTRAINT IF EXISTS organization_memberships_tenant_user_fk;

DROP INDEX IF EXISTS users_organization_status_idx;
ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_organization_id_id_unique,
  DROP CONSTRAINT IF EXISTS users_account_tenant_scope_check,
  DROP COLUMN IF EXISTS organization_id,
  DROP COLUMN IF EXISTS account_type;

COMMIT;
