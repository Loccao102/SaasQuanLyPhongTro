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
  ALTER COLUMN organization_id DROP NOT NULL,
  ADD COLUMN payment_reference text,
  ADD COLUMN reconciliation_status text NOT NULL DEFAULT 'UNMATCHED'
    CHECK (reconciliation_status IN (
      'UNMATCHED',
      'ALLOCATED',
      'REVIEW_REQUIRED'
    ));

UPDATE renter_payment_transactions t
SET reconciliation_status = 'ALLOCATED'
WHERE EXISTS (
  SELECT 1
  FROM renter_payment_allocations a
  WHERE a.payment_transaction_id = t.id
);

ALTER TABLE renter_payment_transactions
  ADD CONSTRAINT renter_payment_transactions_source_org_chk
  CHECK (
    source = 'PROVIDER'
    OR organization_id IS NOT NULL
  );

CREATE UNIQUE INDEX renter_payment_transactions_provider_global_uidx
  ON renter_payment_transactions (provider, provider_transaction_id)
  WHERE provider IS NOT NULL
    AND provider_transaction_id IS NOT NULL;

CREATE INDEX renter_payment_transactions_reference_idx
  ON renter_payment_transactions (
    payment_reference,
    occurred_at DESC,
    id
  )
  WHERE payment_reference IS NOT NULL;

CREATE TABLE renter_billing_webhook_event_links (
  event_id uuid PRIMARY KEY
    REFERENCES saas_billing_webhook_events(id) ON DELETE RESTRICT,
  renter_payment_transaction_id uuid NOT NULL UNIQUE
    REFERENCES renter_payment_transactions(id) ON DELETE RESTRICT,
  normalized_payment_fingerprint text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (normalized_payment_fingerprint ~ '^[a-f0-9]{64}$')
);

COMMIT;
