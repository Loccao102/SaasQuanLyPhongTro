BEGIN;

DELETE FROM system_settings
WHERE key = 'password_registration_enabled';

COMMIT;
