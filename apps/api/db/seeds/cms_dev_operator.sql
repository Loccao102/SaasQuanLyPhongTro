BEGIN;

INSERT INTO users (id, email, display_name, status)
VALUES (
  '00000000-0000-0000-0000-000000000901',
  'cms-dev@local.invalid',
  'CMS Dev Operator',
  'ACTIVE'
)
ON CONFLICT (id) DO UPDATE
SET status = 'ACTIVE', display_name = EXCLUDED.display_name;

INSERT INTO platform_operators (user_id, role, status)
VALUES (
  '00000000-0000-0000-0000-000000000901',
  'PLATFORM_ADMIN',
  'ACTIVE'
)
ON CONFLICT (user_id) DO UPDATE
SET role = EXCLUDED.role, status = 'ACTIVE', updated_at = now();

COMMIT;
