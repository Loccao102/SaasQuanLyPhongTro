BEGIN;

ALTER TABLE users
  ADD COLUMN account_type text NOT NULL DEFAULT 'TENANT'
    CHECK (account_type IN ('TENANT', 'PLATFORM')),
  ADD COLUMN organization_id uuid REFERENCES organizations(id) ON DELETE RESTRICT;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM platform_operators po
    JOIN organization_memberships om ON om.user_id = po.user_id
  ) THEN
    RAISE EXCEPTION 'Platform operators cannot also be tenant memberships before tenant-scoped identity migration.';
  END IF;

  IF EXISTS (
    SELECT om.user_id
    FROM organization_memberships om
    LEFT JOIN platform_operators po ON po.user_id = om.user_id
    WHERE po.user_id IS NULL
    GROUP BY om.user_id
    HAVING count(DISTINCT om.organization_id) > 1
  ) THEN
    RAISE EXCEPTION 'A tenant user belongs to more than one organization; split the account before tenant-scoped identity migration.';
  END IF;
END $$;

UPDATE users u
SET account_type = 'PLATFORM',
    organization_id = NULL
WHERE EXISTS (
  SELECT 1
  FROM platform_operators po
  WHERE po.user_id = u.id
);

UPDATE users u
SET organization_id = membership.organization_id
FROM (
  SELECT user_id, min(organization_id::text)::uuid AS organization_id
  FROM organization_memberships
  GROUP BY user_id
) membership
WHERE membership.user_id = u.id
  AND u.account_type = 'TENANT';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM users
    WHERE account_type = 'TENANT'
      AND organization_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Every tenant user must belong to exactly one organization.';
  END IF;
END $$;

ALTER TABLE users
  ADD CONSTRAINT users_account_tenant_scope_check
  CHECK (
    (account_type = 'PLATFORM' AND organization_id IS NULL)
    OR
    (account_type = 'TENANT' AND organization_id IS NOT NULL)
  ),
  ADD CONSTRAINT users_organization_id_id_unique
  UNIQUE (organization_id, id);

CREATE INDEX users_organization_status_idx
  ON users (organization_id, status)
  WHERE account_type = 'TENANT';

ALTER TABLE organization_memberships
  ADD CONSTRAINT organization_memberships_tenant_user_fk
  FOREIGN KEY (organization_id, user_id)
  REFERENCES users (organization_id, id)
  ON DELETE CASCADE;

ALTER TABLE auth_sessions
  ADD COLUMN organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE;

UPDATE auth_sessions s
SET organization_id = u.organization_id
FROM users u
WHERE u.id = s.user_id;

CREATE INDEX auth_sessions_org_user_active_idx
  ON auth_sessions (organization_id, user_id, expires_at DESC)
  WHERE revoked_at IS NULL;

CREATE TABLE user_auth_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('GOOGLE')),
  provider_subject text NOT NULL,
  provider_email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_subject),
  UNIQUE (user_id, provider)
);

CREATE INDEX user_auth_identities_user_idx
  ON user_auth_identities (user_id);

ALTER TABLE organization_entitlement_overrides
  DROP CONSTRAINT IF EXISTS organization_entitlement_overrides_entitlement_key_check;

ALTER TABLE organization_entitlement_overrides
  ADD CONSTRAINT organization_entitlement_overrides_entitlement_key_check
  CHECK (entitlement_key IN (
    'room_limit',
    'staff_limit',
    'automation_actions_monthly',
    'properties',
    'leases',
    'metering',
    'billing',
    'payments',
    'maintenance',
    'notifications',
    'reports',
    'team_management',
    'advanced_reports',
    'audit_log'
  ));

UPDATE saas_plan_versions
SET features = COALESCE(features, '{}'::jsonb) || jsonb_build_object(
  'properties', true,
  'leases', true,
  'metering', true,
  'billing', true,
  'payments', true,
  'maintenance', true,
  'notifications', true,
  'reports', true,
  'team_management', true
);

INSERT INTO system_settings (
  key,
  group_key,
  label,
  description,
  value,
  value_type
)
VALUES (
  'google_auth_enabled',
  'Identity',
  'Đăng nhập Google',
  'Cho phép tenant user đăng nhập/đăng ký bằng Google Identity Services.',
  'true'::jsonb,
  'BOOLEAN'
)
ON CONFLICT (key) DO NOTHING;

COMMIT;
