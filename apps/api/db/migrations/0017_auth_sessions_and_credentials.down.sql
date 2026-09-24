BEGIN;

DROP TABLE IF EXISTS auth_sessions;
DROP TABLE IF EXISTS user_password_credentials;

ALTER TABLE users
  DROP COLUMN IF EXISTS auth_version;

COMMIT;
