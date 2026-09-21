BEGIN;

DROP INDEX IF EXISTS properties_dashboard_active_idx;
DROP INDEX IF EXISTS residents_dashboard_active_idx;
DROP INDEX IF EXISTS leases_dashboard_expiry_idx;

DELETE FROM system_settings
WHERE key IN (
  'brand_product_name',
  'brand_product_descriptor',
  'brand_tagline',
  'brand_palette',
  'display_locale',
  'display_timezone',
  'display_currency_code',
  'display_date_format',
  'display_datetime_format',
  'display_format_presets',
  'dashboard_lease_expiry_days',
  'dashboard_recent_window_hours',
  'worker_stale_after_seconds'
);

COMMIT;
