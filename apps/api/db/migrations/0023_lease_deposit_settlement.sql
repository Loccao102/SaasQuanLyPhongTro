BEGIN;

CREATE TABLE lease_deposit_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  lease_id uuid NOT NULL,
  entry_type text NOT NULL
    CHECK (entry_type IN ('COLLECTION', 'REFUND', 'DEDUCTION')),
  amount_vnd bigint NOT NULL CHECK (amount_vnd > 0),
  occurred_at timestamptz NOT NULL,
  note text,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, lease_id)
    REFERENCES leases (organization_id, id)
    ON DELETE RESTRICT,
  UNIQUE (organization_id, id)
);

CREATE INDEX lease_deposit_entries_lease_history_idx
  ON lease_deposit_entries (
    organization_id,
    lease_id,
    occurred_at DESC,
    created_at DESC,
    id
  );

COMMIT;
