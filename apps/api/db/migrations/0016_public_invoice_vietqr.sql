BEGIN;

CREATE TABLE organization_payment_profiles (
  organization_id uuid PRIMARY KEY
    REFERENCES organizations(id) ON DELETE CASCADE,
  bank_id text NOT NULL,
  account_no text NOT NULL,
  account_name text NOT NULL,
  vietqr_template text NOT NULL DEFAULT 'compact2',
  is_active boolean NOT NULL DEFAULT true,
  updated_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (char_length(bank_id) BETWEEN 2 AND 32),
  CHECK (char_length(account_no) BETWEEN 3 AND 19),
  CHECK (char_length(account_name) BETWEEN 2 AND 80),
  CHECK (char_length(vietqr_template) BETWEEN 1 AND 64)
);

CREATE TABLE renter_invoice_public_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  invoice_id uuid NOT NULL,
  token_hash char(64) NOT NULL UNIQUE,
  token_hint text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'REVOKED')),
  expires_at timestamptz,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  revoked_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, invoice_id)
    REFERENCES renter_invoices (organization_id, id)
    ON DELETE CASCADE,
  UNIQUE (organization_id, id),
  CHECK (
    (status = 'ACTIVE' AND revoked_at IS NULL)
    OR
    (status = 'REVOKED' AND revoked_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX renter_invoice_public_links_one_active_uidx
  ON renter_invoice_public_links (organization_id, invoice_id)
  WHERE status = 'ACTIVE';

CREATE INDEX renter_invoice_public_links_invoice_idx
  ON renter_invoice_public_links (
    organization_id,
    invoice_id,
    status,
    created_at DESC
  );

COMMIT;
