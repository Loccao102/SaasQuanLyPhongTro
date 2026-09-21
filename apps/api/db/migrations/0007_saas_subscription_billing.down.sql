BEGIN;

DELETE FROM system_settings
WHERE key IN (
  'renewal_invoice_lead_days',
  'past_due_warning_days'
);

DROP TABLE IF EXISTS saas_subscription_payment_allocations;
DROP TABLE IF EXISTS saas_subscription_payments;
DROP TABLE IF EXISTS saas_subscription_invoices;

DROP INDEX IF EXISTS organization_subscriptions_org_id_uidx;

ALTER TABLE organization_subscriptions
  DROP COLUMN IF EXISTS past_due_at,
  DROP COLUMN IF EXISTS billing_interval;

COMMIT;
