BEGIN;

ALTER TABLE renter_invoices
  ADD COLUMN paid_vnd bigint NOT NULL DEFAULT 0,
  ADD COLUMN remaining_vnd bigint NOT NULL DEFAULT 0,
  ADD COLUMN collection_status text NOT NULL DEFAULT 'UNPAID'
    CHECK (collection_status IN ('UNPAID', 'PARTIALLY_PAID', 'PAID'));

UPDATE renter_invoices
SET
  paid_vnd = 0,
  remaining_vnd = total_vnd,
  collection_status = CASE
    WHEN total_vnd = 0 THEN 'PAID'
    ELSE 'UNPAID'
  END;

ALTER TABLE renter_invoices
  ADD CONSTRAINT renter_invoices_paid_nonnegative_chk
    CHECK (paid_vnd >= 0),
  ADD CONSTRAINT renter_invoices_remaining_nonnegative_chk
    CHECK (remaining_vnd >= 0),
  ADD CONSTRAINT renter_invoices_payment_projection_chk
    CHECK (paid_vnd + remaining_vnd = total_vnd);

CREATE INDEX renter_invoices_collection_idx
  ON renter_invoices (
    organization_id,
    collection_status,
    due_date,
    id
  )
  WHERE status = 'ISSUED';

CREATE TABLE renter_payment_transactions (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  source text NOT NULL CHECK (source IN ('MANUAL', 'PROVIDER')),
  provider text,
  provider_transaction_id text,
  amount_vnd bigint NOT NULL CHECK (amount_vnd > 0),
  occurred_at timestamptz NOT NULL,
  payer_name text,
  note text,
  status text NOT NULL DEFAULT 'POSTED'
    CHECK (status IN ('POSTED', 'REVERSED')),
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (source = 'MANUAL')
    OR
    (source = 'PROVIDER' AND provider IS NOT NULL AND provider_transaction_id IS NOT NULL)
  ),
  UNIQUE (organization_id, id)
);

CREATE UNIQUE INDEX renter_payment_transactions_provider_uidx
  ON renter_payment_transactions (
    organization_id,
    provider,
    provider_transaction_id
  )
  WHERE provider IS NOT NULL AND provider_transaction_id IS NOT NULL;

CREATE INDEX renter_payment_transactions_time_idx
  ON renter_payment_transactions (
    organization_id,
    occurred_at DESC,
    id
  );

CREATE TABLE renter_payment_allocations (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  payment_transaction_id uuid NOT NULL,
  invoice_id uuid NOT NULL,
  amount_vnd bigint NOT NULL CHECK (amount_vnd > 0),
  allocation_type text NOT NULL DEFAULT 'MANUAL'
    CHECK (allocation_type IN ('MANUAL', 'AUTO')),
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, payment_transaction_id)
    REFERENCES renter_payment_transactions (organization_id, id)
    ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, invoice_id)
    REFERENCES renter_invoices (organization_id, id)
    ON DELETE RESTRICT,
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, payment_transaction_id, invoice_id)
);

CREATE INDEX renter_payment_allocations_invoice_idx
  ON renter_payment_allocations (
    organization_id,
    invoice_id,
    created_at,
    id
  );

COMMIT;
