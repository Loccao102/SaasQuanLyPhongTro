BEGIN;

ALTER TABLE auth_mfa_challenges
  ADD COLUMN purpose text NOT NULL DEFAULT 'VERIFY'
    CHECK (purpose IN ('VERIFY', 'ENROLL'));

CREATE INDEX auth_mfa_challenges_purpose_active_idx
  ON auth_mfa_challenges (user_id, purpose, expires_at)
  WHERE consumed_at IS NULL;

INSERT INTO system_settings (
  key,
  group_key,
  label,
  description,
  value,
  value_type
)
VALUES
  (
    'mfa_required_tenant_roles',
    'Identity',
    'Tenant roles bắt buộc MFA',
    'Danh sách role tenant phải hoàn tất MFA trước khi được cấp browser session.',
    '["OWNER"]'::jsonb,
    'JSON'
  ),
  (
    'mfa_required_platform_roles',
    'Identity',
    'Platform roles bắt buộc MFA',
    'Danh sách role Control Plane phải hoàn tất MFA trước khi được cấp browser session.',
    '["PLATFORM_ADMIN"]'::jsonb,
    'JSON'
  )
ON CONFLICT (key) DO NOTHING;

COMMIT;
