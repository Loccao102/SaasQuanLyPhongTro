BEGIN;

DROP INDEX IF EXISTS notification_attempts_dashboard_finished_idx;
DROP INDEX IF EXISTS saas_subscription_payments_dashboard_trend_idx;

UPDATE system_settings
SET value = value
  - 'compactInteger'
  - 'moneyCompact'
  - 'decimal'
  - 'monthYear'
  - 'isoDate'
  - 'isoDateTime'
WHERE key = 'display_format_presets'
  AND jsonb_typeof(value) = 'object';

DELETE FROM system_settings
WHERE key IN (
  'dashboard_trend_months',
  'dashboard_top_items_limit',
  'dashboard_lease_expiry_buckets'
);

COMMIT;
