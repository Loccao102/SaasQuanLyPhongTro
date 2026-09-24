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

-- Backfill previously ingested SePay webhook transactions so the first API-v2
-- reconciliation sweep cannot create a second financial effect for the same
-- bank transaction. We only backfill records with strong, safely serializable
-- evidence. Any pre-existing duplicate canonical evidence intentionally fails
-- this migration instead of silently choosing one transaction.
WITH legacy_sepay AS (
  SELECT
    t.id AS payment_transaction_id,
    t.provider_transaction_id AS alias_value,
    upper(trim(t.raw_payload ->> 'referenceCode')) AS reference_number,
    upper(
      regexp_replace(
        trim(t.raw_payload ->> 'accountNumber'),
        '\s+',
        '',
        'g'
      )
    ) AS destination_account_no,
    t.occurred_at,
    t.amount_vnd,
    encode(
      digest(
        '{"provider":"SEPAY","referenceNumber":"' ||
        upper(trim(t.raw_payload ->> 'referenceCode')) ||
        '","destinationAccountNo":"' ||
        upper(
          regexp_replace(
            trim(t.raw_payload ->> 'accountNumber'),
            '\s+',
            '',
            'g'
          )
        ) ||
        '","occurredAt":"' ||
        to_char(
          t.occurred_at AT TIME ZONE 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
        ) ||
        '","direction":"IN","amountVnd":' ||
        t.amount_vnd::text ||
        '}',
        'sha256'
      ),
      'hex'
    ) AS canonical_fingerprint
  FROM renter_payment_transactions t
  WHERE t.source = 'PROVIDER'
    AND t.provider = 'SEPAY'
    AND t.provider_transaction_id ~ '^[1-9][0-9]*$'
    AND coalesce(trim(t.raw_payload ->> 'referenceCode'), '')
      ~ '^[A-Za-z0-9._/-]+$'
    AND coalesce(
      regexp_replace(
        trim(t.raw_payload ->> 'accountNumber'),
        '\s+',
        '',
        'g'
      ),
      ''
    ) ~ '^[A-Za-z0-9]+$'
)
INSERT INTO renter_provider_transaction_identities (
  id,
  provider,
  canonical_fingerprint,
  reference_number,
  destination_account_no,
  occurred_at,
  direction,
  amount_vnd,
  payment_transaction_id
)
SELECT
  gen_random_uuid(),
  'SEPAY',
  legacy.canonical_fingerprint,
  legacy.reference_number,
  legacy.destination_account_no,
  legacy.occurred_at,
  'IN',
  legacy.amount_vnd,
  legacy.payment_transaction_id
FROM legacy_sepay legacy;

INSERT INTO renter_provider_transaction_aliases (
  provider,
  identity_id,
  alias_type,
  alias_value
)
SELECT
  identity.provider,
  identity.id,
  'SEPAY_WEBHOOK_NUMERIC_ID',
  transaction.provider_transaction_id
FROM renter_provider_transaction_identities identity
JOIN renter_payment_transactions transaction
  ON transaction.id = identity.payment_transaction_id
WHERE identity.provider = 'SEPAY'
  AND transaction.provider = 'SEPAY'
  AND transaction.source = 'PROVIDER'
  AND transaction.provider_transaction_id ~ '^[1-9][0-9]*$';

COMMIT;
