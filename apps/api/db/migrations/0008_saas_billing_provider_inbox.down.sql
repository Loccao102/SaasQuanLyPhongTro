BEGIN;

DROP TABLE IF EXISTS saas_billing_webhook_events;

ALTER TABLE saas_subscription_payments
  DROP CONSTRAINT IF EXISTS saas_subscription_payments_assignment_check,
  ALTER COLUMN organization_id SET NOT NULL,
  ALTER COLUMN subscription_id SET NOT NULL;

DROP INDEX IF EXISTS saas_subscription_invoices_payment_reference_uidx;

ALTER TABLE saas_subscription_invoices
  DROP COLUMN IF EXISTS payment_reference;

COMMIT;
