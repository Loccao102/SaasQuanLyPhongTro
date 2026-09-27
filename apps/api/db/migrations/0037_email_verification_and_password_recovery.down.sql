BEGIN;

DROP TABLE IF EXISTS auth_password_reset_tokens;
DROP TABLE IF EXISTS auth_pending_registrations;

ALTER TABLE users
  DROP COLUMN IF EXISTS email_verified_at;

COMMIT;
