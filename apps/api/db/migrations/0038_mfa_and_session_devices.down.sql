BEGIN;

DROP TABLE IF EXISTS auth_mfa_challenges;
DROP TABLE IF EXISTS user_mfa_recovery_codes;
DROP TABLE IF EXISTS user_totp_credentials;

ALTER TABLE auth_sessions
  DROP COLUMN IF EXISTS device_label,
  DROP COLUMN IF EXISTS user_agent;

COMMIT;
