BEGIN;

INSERT INTO system_settings (
  key,
  group_key,
  label,
  description,
  value,
  value_type
)
VALUES (
  'password_registration_enabled',
  'Security',
  'Cho phép self-register bằng mật khẩu',
  'Cho phép tenant OWNER mới tự đăng ký bằng email/mật khẩu. Nên tắt ở production cho tới khi có email verification/recovery provider.',
  'true'::jsonb,
  'BOOLEAN'
)
ON CONFLICT (key) DO NOTHING;

COMMIT;
