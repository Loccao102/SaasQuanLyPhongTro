ALTER TABLE leases
  DROP COLUMN IF EXISTS signature_data_url,
  DROP COLUMN IF EXISTS signed_at,
  DROP COLUMN IF EXISTS signed_by_name,
  DROP COLUMN IF EXISTS signed_ip;
