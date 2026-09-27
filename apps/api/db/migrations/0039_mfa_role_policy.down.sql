BEGIN;

DELETE FROM system_settings
WHERE key IN (
  'mfa_required_tenant_roles',
  'mfa_required_platform_roles'
);

DROP INDEX IF EXISTS auth_mfa_challenges_purpose_active_idx;

ALTER TABLE auth_mfa_challenges
  DROP COLUMN IF EXISTS purpose;

COMMIT;
