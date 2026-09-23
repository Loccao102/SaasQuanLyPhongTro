BEGIN;

DROP TABLE IF EXISTS renter_payment_allocations;
DROP TABLE IF EXISTS renter_payment_transactions;

DROP INDEX IF EXISTS renter_invoices_collection_idx;

ALTER TABLE renter_invoices
  DROP CONSTRAINT IF EXISTS renter_invoices_payment_projection_chk,
  DROP CONSTRAINT IF EXISTS renter_invoices_remaining_nonnegative_chk,
  DROP CONSTRAINT IF EXISTS renter_invoices_paid_nonnegative_chk,
  DROP COLUMN IF EXISTS collection_status,
  DROP COLUMN IF EXISTS remaining_vnd,
  DROP COLUMN IF EXISTS paid_vnd;

COMMIT;
