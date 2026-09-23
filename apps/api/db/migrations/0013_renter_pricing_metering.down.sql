BEGIN;

DROP INDEX IF EXISTS renter_invoices_calculation_status_idx;

ALTER TABLE renter_invoices
  DROP COLUMN IF EXISTS calculated_at,
  DROP COLUMN IF EXISTS review_reasons,
  DROP COLUMN IF EXISTS calculation_status;

DROP TABLE IF EXISTS meter_readings;
DROP TABLE IF EXISTS meters;
DROP TABLE IF EXISTS pricing_policy_items;
DROP TABLE IF EXISTS pricing_policies;

COMMIT;
