BEGIN;

DROP TABLE IF EXISTS automation_quota_consumptions;
DROP TABLE IF EXISTS automation_quota_reservations;
DROP TABLE IF EXISTS automation_quota_periods;

DELETE FROM system_settings
WHERE key = 'automation_quota_timezone';

COMMIT;
