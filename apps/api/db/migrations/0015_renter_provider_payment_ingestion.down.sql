BEGIN;

DROP TABLE IF EXISTS renter_billing_webhook_event_links;

DROP INDEX IF EXISTS renter_payment_transactions_reference_idx;
DROP INDEX IF EXISTS renter_payment_transactions_provider_global_uidx;

ALTER TABLE renter_payment_transactions
  DROP CONSTRAINT IF EXISTS renter_payment_transactions_source_org_chk,
  DROP COLUMN IF EXISTS reconciliation_status,
  DROP COLUMN IF EXISTS payment_reference,
  ALTER COLUMN organization_id SET NOT NULL;

DROP INDEX IF EXISTS renter_invoices_payment_reference_uidx;

ALTER TABLE renter_invoices
  DROP COLUMN IF EXISTS payment_reference;

COMMIT;
