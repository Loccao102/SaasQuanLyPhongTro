BEGIN;

CREATE TABLE platform_operators (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL
    CHECK (role IN ('PLATFORM_ADMIN', 'SUPPORT_OPERATOR', 'OPS_OPERATOR', 'READ_ONLY_AUDITOR')),
  status text NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'SUSPENDED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE system_settings (
  key text PRIMARY KEY,
  group_key text NOT NULL,
  label text NOT NULL,
  description text NOT NULL DEFAULT '',
  value jsonb NOT NULL,
  value_type text NOT NULL
    CHECK (value_type IN ('BOOLEAN', 'INTEGER', 'STRING', 'JSON')),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  is_sensitive boolean NOT NULL DEFAULT false,
  updated_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX system_settings_group_idx ON system_settings (group_key, key);

CREATE TABLE saas_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'ARCHIVED')),
  current_version_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE saas_plan_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES saas_plans(id) ON DELETE RESTRICT,
  version integer NOT NULL CHECK (version >= 1),
  monthly_price_vnd bigint NOT NULL CHECK (monthly_price_vnd >= 0),
  yearly_price_vnd bigint CHECK (yearly_price_vnd IS NULL OR yearly_price_vnd >= 0),
  room_limit integer NOT NULL CHECK (room_limit >= 1),
  staff_limit integer NOT NULL CHECK (staff_limit >= 1),
  automation_quota integer NOT NULL CHECK (automation_quota >= 0),
  features jsonb NOT NULL DEFAULT '{}'::jsonb,
  effective_from timestamptz NOT NULL DEFAULT now(),
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (plan_id, version),
  UNIQUE (plan_id, id)
);

ALTER TABLE saas_plans
  ADD CONSTRAINT saas_plans_current_version_fk
  FOREIGN KEY (id, current_version_id)
  REFERENCES saas_plan_versions(plan_id, id)
  ON DELETE RESTRICT;

CREATE TABLE organization_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE RESTRICT,
  plan_id uuid NOT NULL REFERENCES saas_plans(id) ON DELETE RESTRICT,
  plan_version_id uuid NOT NULL,
  status text NOT NULL
    CHECK (status IN ('TRIALING', 'ACTIVE', 'PAST_DUE', 'GRACE_PERIOD', 'SUSPENDED', 'CANCELLED')),
  trial_ends_at timestamptz,
  current_period_start timestamptz,
  current_period_end timestamptz,
  grace_ends_at timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (plan_id, plan_version_id)
    REFERENCES saas_plan_versions(plan_id, id)
    ON DELETE RESTRICT
);

CREATE INDEX organization_subscriptions_status_idx
  ON organization_subscriptions (status, current_period_end);

CREATE TABLE organization_entitlement_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entitlement_key text NOT NULL
    CHECK (entitlement_key IN (
      'room_limit',
      'staff_limit',
      'automation_actions_monthly',
      'advanced_reports',
      'audit_log'
    )),
  value jsonb NOT NULL,
  expires_at timestamptz,
  reason text NOT NULL,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoked_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  CHECK (revoked_at IS NOT NULL OR revoked_by_user_id IS NULL)
);

CREATE UNIQUE INDEX organization_entitlement_overrides_active_uidx
  ON organization_entitlement_overrides (organization_id, entitlement_key)
  WHERE revoked_at IS NULL;

CREATE INDEX organization_entitlement_overrides_org_idx
  ON organization_entitlement_overrides (
    organization_id,
    entitlement_key,
    created_at DESC
  );

CREATE TABLE platform_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL,
  target_type text NOT NULL,
  target_key text NOT NULL,
  organization_id uuid REFERENCES organizations(id) ON DELETE RESTRICT,
  before_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  after_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  reason text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX platform_audit_events_time_idx
  ON platform_audit_events (occurred_at DESC, id);
CREATE INDEX platform_audit_events_target_idx
  ON platform_audit_events (target_type, target_key, occurred_at DESC);
CREATE INDEX platform_audit_events_org_idx
  ON platform_audit_events (organization_id, occurred_at DESC)
  WHERE organization_id IS NOT NULL;

CREATE TABLE platform_command_receipts (
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL,
  action text NOT NULL,
  request_fingerprint text NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (actor_user_id, idempotency_key)
);

CREATE INDEX platform_command_receipts_created_idx
  ON platform_command_receipts (created_at DESC);

INSERT INTO system_settings (key, group_key, label, description, value, value_type)
VALUES
  ('registration_enabled', 'General', 'Cho phép đăng ký mới', 'Bật/tắt signup SaaS.', 'true'::jsonb, 'BOOLEAN'),
  ('maintenance_mode', 'General', 'Maintenance mode', 'Chuyển tenant surfaces sang maintenance policy.', 'false'::jsonb, 'BOOLEAN'),
  ('trial_days', 'Billing', 'Số ngày dùng thử', 'Thời lượng trial mặc định.', '30'::jsonb, 'INTEGER'),
  ('grace_period_days', 'Billing', 'Grace period', 'Số ngày trước khi subscription chuyển read-only.', '7'::jsonb, 'INTEGER'),
  ('notification_retry_limit', 'Automation', 'Notification retry limit', 'Giới hạn retry tự động.', '3'::jsonb, 'INTEGER'),
  ('playwright_provider_enabled', 'Automation', 'Playwright provider', 'Edge provider chuyển tiếp cho Zalo.', 'true'::jsonb, 'BOOLEAN');

INSERT INTO saas_plans (code, name)
VALUES
  ('STARTER', 'Starter'),
  ('GROWTH', 'Growth'),
  ('PRO', 'Pro'),
  ('BUSINESS', 'Business');

WITH target AS (SELECT id FROM saas_plans WHERE code = 'STARTER'),
version_row AS (
  INSERT INTO saas_plan_versions (
    plan_id, version, monthly_price_vnd, yearly_price_vnd,
    room_limit, staff_limit, automation_quota, reason
  )
  SELECT id, 1, 99000, 950000, 20, 2, 500, 'Initial pricing V1'
  FROM target
  RETURNING id, plan_id
)
UPDATE saas_plans p
SET current_version_id = v.id
FROM version_row v
WHERE p.id = v.plan_id;

WITH target AS (SELECT id FROM saas_plans WHERE code = 'GROWTH'),
version_row AS (
  INSERT INTO saas_plan_versions (
    plan_id, version, monthly_price_vnd, yearly_price_vnd,
    room_limit, staff_limit, automation_quota, reason
  )
  SELECT id, 1, 249000, 2390000, 60, 5, 1000, 'Initial pricing V1'
  FROM target
  RETURNING id, plan_id
)
UPDATE saas_plans p
SET current_version_id = v.id
FROM version_row v
WHERE p.id = v.plan_id;

WITH target AS (SELECT id FROM saas_plans WHERE code = 'PRO'),
version_row AS (
  INSERT INTO saas_plan_versions (
    plan_id, version, monthly_price_vnd, yearly_price_vnd,
    room_limit, staff_limit, automation_quota, reason
  )
  SELECT id, 1, 499000, 4790000, 150, 10, 5000, 'Initial pricing V1'
  FROM target
  RETURNING id, plan_id
)
UPDATE saas_plans p
SET current_version_id = v.id
FROM version_row v
WHERE p.id = v.plan_id;

WITH target AS (SELECT id FROM saas_plans WHERE code = 'BUSINESS'),
version_row AS (
  INSERT INTO saas_plan_versions (
    plan_id, version, monthly_price_vnd, yearly_price_vnd,
    room_limit, staff_limit, automation_quota, reason
  )
  SELECT id, 1, 799000, 7670000, 300, 20, 15000, 'Initial pricing V1'
  FROM target
  RETURNING id, plan_id
)
UPDATE saas_plans p
SET current_version_id = v.id
FROM version_row v
WHERE p.id = v.plan_id;

COMMIT;
