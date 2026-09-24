BEGIN;

CREATE TABLE renter_provider_transaction_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  canonical_fingerprint char(64) NOT NULL,
  reference_number text NOT NULL,
  destination_account_no text NOT NULL,
  occurred_at timestamptz NOT NULL,
  direction text NOT NULL CHECK (direction IN ('IN', 'OUT')),
  amount_vnd bigint NOT NULL CHECK (amount_vnd > 0),
  payment_transaction_id uuid
    REFERENCES renter_payment_transactions(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, canonical_fingerprint),
  UNIQUE (provider, id),
  UNIQUE (payment_transaction_id),
  CHECK (canonical_fingerprint ~ '^[a-f0-9]{64}$')
);

CREATE INDEX renter_provider_transaction_identities_reference_idx
  ON renter_provider_transaction_identities (
    provider,
    reference_number,
    occurred_at DESC
  );

CREATE TABLE renter_provider_transaction_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  identity_id uuid NOT NULL,
  alias_type text NOT NULL,
  alias_value text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (provider, identity_id)
    REFERENCES renter_provider_transaction_identities(provider, id)
    ON DELETE CASCADE,
  UNIQUE (provider, alias_type, alias_value)
);

CREATE INDEX renter_provider_transaction_aliases_identity_idx
  ON renter_provider_transaction_aliases (
    provider,
    identity_id,
    created_at
  );

COMMIT;
