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
    'brand_product_name',
    'Brand',
    'Tên sản phẩm',
    'Tên thương hiệu hiển thị trên các surface của platform.',
    '"Habi"'::jsonb,
    'STRING'
  ),
  (
    'brand_product_descriptor',
    'Brand',
    'Mô tả sản phẩm',
    'Mô tả ngắn đi cùng wordmark.',
    '"SaaS vận hành nhà cho thuê"'::jsonb,
    'STRING'
  ),
  (
    'brand_tagline',
    'Brand',
    'Tagline',
    'Thông điệp thương hiệu ngắn dùng trên dashboard và landing surfaces.',
    '"Nhà gọn. Việc trôi."'::jsonb,
    'STRING'
  ),
  (
    'brand_palette',
    'Brand',
    'Bảng màu thương hiệu',
    'Design tokens mặc định cho Habi.',
    '{"navy":"#25355C","teal":"#35C6A8","amber":"#FFB36B","background":"#F7FAF9","surface":"#FFFFFF"}'::jsonb,
    'JSON'
  ),
  (
    'display_locale',
    'Display',
    'Locale mặc định',
    'Locale dùng để format số, tiền và thời gian trong UI.',
    '"vi-VN"'::jsonb,
    'STRING'
  ),
  (
    'display_timezone',
    'Display',
    'Timezone mặc định',
    'Timezone nghiệp vụ mặc định của platform.',
    '"Asia/Ho_Chi_Minh"'::jsonb,
    'STRING'
  ),
  (
    'display_currency_code',
    'Display',
    'Mã tiền tệ',
    'ISO currency code mặc định.',
    '"VND"'::jsonb,
    'STRING'
  ),
  (
    'display_date_format',
    'Display',
    'Format ngày',
    'Format ngày chuẩn hiển thị trong sản phẩm.',
    '"dd/MM/yyyy"'::jsonb,
    'STRING'
  ),
  (
    'display_datetime_format',
    'Display',
    'Format ngày giờ',
    'Format ngày giờ chuẩn hiển thị trong sản phẩm.',
    '"dd/MM/yyyy HH:mm"'::jsonb,
    'STRING'
  ),
  (
    'display_format_presets',
    'Display',
    'Format presets',
    'Các preset format có thể tái sử dụng giữa dashboard/report/export.',
    '{
      "money":{"style":"currency","currency":"VND","maximumFractionDigits":0},
      "integer":{"maximumFractionDigits":0},
      "percent":{"minimumFractionDigits":0,"maximumFractionDigits":1},
      "date":{"pattern":"dd/MM/yyyy"},
      "dateTime":{"pattern":"dd/MM/yyyy HH:mm"}
    }'::jsonb,
    'JSON'
  ),
  (
    'dashboard_lease_expiry_days',
    'Dashboard',
    'Cửa sổ hợp đồng sắp hết hạn',
    'Số ngày tương lai dùng để đếm hợp đồng sắp hết hạn trên dashboard.',
    '30'::jsonb,
    'INTEGER'
  ),
  (
    'dashboard_recent_window_hours',
    'Dashboard',
    'Cửa sổ dữ liệu gần đây',
    'Số giờ dùng cho các KPI gần đây như audit, payment và notification.',
    '24'::jsonb,
    'INTEGER'
  ),
  (
    'worker_stale_after_seconds',
    'Automation',
    'Worker stale threshold',
    'Số giây không heartbeat trước khi worker được coi là stale trên dashboard.',
    '60'::jsonb,
    'INTEGER'
  )
ON CONFLICT (key) DO NOTHING;

CREATE INDEX IF NOT EXISTS leases_dashboard_expiry_idx
  ON leases (planned_end_date, organization_id)
  WHERE planned_end_date IS NOT NULL
    AND status IN ('ACTIVE', 'TERMINATION_SCHEDULED');

CREATE INDEX IF NOT EXISTS residents_dashboard_active_idx
  ON residents (organization_id, id)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS properties_dashboard_active_idx
  ON properties (organization_id, id)
  WHERE is_active = true;

COMMIT;
