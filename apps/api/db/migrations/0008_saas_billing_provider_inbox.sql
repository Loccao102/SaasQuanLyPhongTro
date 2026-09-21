BEGIN;

ALTER TABLE saas_subscription_invoices
  ADD COLUMN payment_reference text;

UPDATE saas_subscription_invoices
SET payment_reference =
  'SAAS' || upper(replace(id::text, '-', ''))
WHERE payment_reference IS NULL;

ALTER TABLE saas_subscription_invoices
  ALTER COLUMN payment_reference SET NOT NULL,
  ALTER COLUMN payment_reference SET DEFAULT (
    'SAAS' || upper(replace(gen_random_uuid()::text, '-', ''))
  );

CREATE UNIQUE INDEX saas_subscription_invoices_payment_reference_uidx
  ON saas_subscription_invoices (payment_reference);

ALTER TABLE saas_subscription_payments
  ALTER COLUMN organization_id DROP NOT NULL,
  ALTER COLUMN subscription_id DROP NOT NULL;

ALTER TABLE saas_subscription_payments
  ADD CONSTRAINT saas_subscription_payments_assignment_check
  CHECK (
    (organization_id IS NULL AND subscription_id IS NULL)
    OR
    (organization_id IS NOT NULL AND subscription_id IS NOT NULL)
  );

CREATE TABLE saas_billing_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  provider_event_id text NOT NULL,
  signature_status text NOT NULL
    CHECK (signature_status IN (
      'VERIFIED',
      'INVALID',
      'NOT_CONFIGURED'
    )),
  processing_status text NOT NULL DEFAULT 'RECEIVED'
    CHECK (processing_status IN (
      'RECEIVED',
      'PROCESSING',
      'PROCESSED',
      'REVIEW_REQUIRED',
      'IGNORED',
      'FAILED'
    )),
  raw_body text NOT NULL,
  raw_body_sha256 text NOT NULL,
  headers jsonb NOT NULL DEFAULT '{}'::jsonb,
  received_at timestamptz NOT NULL DEFAULT now(),
  processing_started_at timestamptz,
  processed_at timestamptz,
  last_error_code text,
  last_error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_event_id)
);

CREATE INDEX saas_billing_webhook_events_processing_idx
  ON saas_billing_webhook_events (
    processing_status,
    received_at,
    provider
  );

CREATE INDEX saas_billing_webhook_events_provider_received_idx
  ON saas_billing_webhook_events (
    provider,
    received_at DESC
  );

COMMIT;
