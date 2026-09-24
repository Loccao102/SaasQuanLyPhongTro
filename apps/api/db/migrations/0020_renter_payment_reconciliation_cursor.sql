BEGIN;

CREATE TABLE renter_payment_reconciliation_cursors (
  provider text NOT NULL,
  scope_key text NOT NULL,
  cursor_value text,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  last_success_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, scope_key),
  CHECK (length(provider) BETWEEN 1 AND 64),
  CHECK (length(scope_key) BETWEEN 1 AND 128),
  CHECK (cursor_value IS NULL OR length(cursor_value) BETWEEN 1 AND 256)
);

CREATE INDEX renter_payment_reconciliation_cursors_success_idx
  ON renter_payment_reconciliation_cursors (
    provider,
    last_success_at DESC NULLS LAST
  );

COMMIT;
