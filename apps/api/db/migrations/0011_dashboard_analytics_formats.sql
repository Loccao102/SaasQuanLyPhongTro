BEGIN;

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
    'dashboard_trend_months',
    'Dashboard',
    'Số tháng hiển thị trend',
    'Số tháng gần nhất dùng cho các biểu đồ trend trên Control Plane.',
    '6'::jsonb,
    'INTEGER'
  ),
  (
    'dashboard_top_items_limit',
    'Dashboard',
    'Số mục top dashboard',
    'Giới hạn số organization/plan hiển thị trong các ranking dashboard.',
    '5'::jsonb,
    'INTEGER'
  ),
  (
    'dashboard_lease_expiry_buckets',
    'Dashboard',
    'Bucket hợp đồng sắp hết hạn',
    'Các mốc ngày dùng để chia nhóm hợp đồng sắp hết hạn.',
    '[7,30,60]'::jsonb,
    'JSON'
  )
ON CONFLICT (key) DO NOTHING;

UPDATE system_settings
SET value = value || '{
  "compactInteger":{"notation":"compact","maximumFractionDigits":1},
  "moneyCompact":{"style":"currency","currency":"VND","notation":"compact","maximumFractionDigits":1},
  "decimal":{"minimumFractionDigits":0,"maximumFractionDigits":2},
  "monthYear":{"pattern":"MM/yyyy"},
  "isoDate":{"pattern":"yyyy-MM-dd"},
  "isoDateTime":{"pattern":"yyyy-MM-dd''T''HH:mm:ssXXX"}
}'::jsonb
WHERE key = 'display_format_presets'
  AND jsonb_typeof(value) = 'object';

CREATE INDEX IF NOT EXISTS saas_subscription_payments_dashboard_trend_idx
  ON saas_subscription_payments (occurred_at DESC)
  WHERE status = 'SUCCEEDED';

CREATE INDEX IF NOT EXISTS notification_attempts_dashboard_finished_idx
  ON notification_attempts (finished_at DESC, outcome)
  WHERE status = 'FINISHED'
    AND finished_at IS NOT NULL;

COMMIT;
