BEGIN;

DELETE FROM system_worker_heartbeats
WHERE role = 'RENTER_PAYMENT_WEBHOOK';

ALTER TABLE system_worker_heartbeats
  DROP CONSTRAINT IF EXISTS system_worker_heartbeats_role_check;

ALTER TABLE system_worker_heartbeats
  ADD CONSTRAINT system_worker_heartbeats_role_check
  CHECK (role IN (
    'NOTIFICATION',
    'BILLING',
    'BILLING_WEBHOOK'
  ));

DELETE FROM system_settings
WHERE key = 'renter_payment_webhook_processing_timeout_seconds';

DROP TABLE IF EXISTS renter_payment_webhook_events;

DROP INDEX IF EXISTS renter_payment_transactions_reconciliation_idx;
DROP INDEX IF EXISTS renter_payment_transactions_provider_global_uidx;

ALTER TABLE renter_payment_transactions
  DROP COLUMN IF EXISTS reconciliation_status,
  DROP COLUMN IF EXISTS payment_reference;

DROP INDEX IF EXISTS renter_invoices_payment_reference_uidx;

ALTER TABLE renter_invoices
  DROP COLUMN IF EXISTS payment_reference;

COMMIT;
