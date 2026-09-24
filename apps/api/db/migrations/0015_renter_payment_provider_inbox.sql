BEGIN;

ALTER TABLE renter_invoices
  ADD COLUMN payment_reference text;

UPDATE renter_invoices
SET payment_reference =
  'RENT' || upper(replace(id::text, '-', ''))
WHERE payment_reference IS NULL;

ALTER TABLE renter_invoices
  ALTER COLUMN payment_reference SET NOT NULL,
  ALTER COLUMN payment_reference SET DEFAULT (
    'RENT' || upper(replace(gen_random_uuid()::text, '-', ''))
  );

CREATE UNIQUE INDEX renter_invoices_payment_reference_uidx
  ON renter_invoices (payment_reference);

ALTER TABLE renter_payment_transactions
  ADD COLUMN payment_reference text,
  ADD COLUMN reconciliation_status text NOT NULL DEFAULT 'ALLOCATED'
    CHECK (reconciliation_status IN ('ALLOCATED', 'REVIEW_REQUIRED'));

CREATE UNIQUE INDEX renter_payment_transactions_provider_global_uidx
  ON renter_payment_transactions (provider, provider_transaction_id)
  WHERE source = 'PROVIDER'
    AND provider IS NOT NULL
    AND provider_transaction_id IS NOT NULL;

CREATE INDEX renter_payment_transactions_reconciliation_idx
  ON renter_payment_transactions (
    reconciliation_status,
    occurred_at DESC,
    id
  )
  WHERE source = 'PROVIDER';

CREATE TABLE renter_payment_webhook_events (
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
  provider_transaction_id text,
  amount_vnd bigint CHECK (amount_vnd IS NULL OR amount_vnd > 0),
  occurred_at timestamptz,
  payment_reference text,
  payer_name text,
  note text,
  normalized_payment_fingerprint text,
  organization_id uuid REFERENCES organizations(id) ON DELETE RESTRICT,
  payment_transaction_id uuid
    REFERENCES renter_payment_transactions(id) ON DELETE RESTRICT,
  received_at timestamptz NOT NULL DEFAULT now(),
  processing_started_at timestamptz,
  processing_attempts integer NOT NULL DEFAULT 0
    CHECK (processing_attempts >= 0),
  processed_at timestamptz,
  last_error_code text,
  last_error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_event_id),
  CHECK (
    (
      provider_transaction_id IS NULL
      AND amount_vnd IS NULL
      AND occurred_at IS NULL
      AND normalized_payment_fingerprint IS NULL
    )
    OR
    (
      provider_transaction_id IS NOT NULL
      AND amount_vnd IS NOT NULL
      AND occurred_at IS NOT NULL
      AND normalized_payment_fingerprint IS NOT NULL
    )
  ),
  CHECK (
    payment_transaction_id IS NULL
    OR organization_id IS NOT NULL
  )
);

CREATE INDEX renter_payment_webhook_events_processing_idx
  ON renter_payment_webhook_events (
    processing_status,
    received_at,
    provider
  );

CREATE INDEX renter_payment_webhook_events_provider_transaction_idx
  ON renter_payment_webhook_events (
    provider,
    provider_transaction_id,
    received_at DESC
  )
  WHERE provider_transaction_id IS NOT NULL;

INSERT INTO system_settings (
  key,
  group_key,
  label,
  description,
  value,
  value_type
)
VALUES (
  'renter_payment_webhook_processing_timeout_seconds',
  'Renter payments',
  'Renter payment webhook processing timeout',
  'Số giây trước khi renter payment webhook PROCESSING được coi là stale và có thể claim lại.',
  '300'::jsonb,
  'INTEGER'
)
ON CONFLICT (key) DO NOTHING;

ALTER TABLE system_worker_heartbeats
  DROP CONSTRAINT IF EXISTS system_worker_heartbeats_role_check;

ALTER TABLE system_worker_heartbeats
  ADD CONSTRAINT system_worker_heartbeats_role_check
  CHECK (role IN (
    'NOTIFICATION',
    'BILLING',
    'BILLING_WEBHOOK',
    'RENTER_PAYMENT_WEBHOOK'
  ));

COMMIT;
