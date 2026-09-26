BEGIN;

CREATE TABLE operating_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  property_id uuid,
  category text NOT NULL
    CHECK (category IN ('REPAIR_MAINTENANCE', 'UTILITIES', 'MANAGEMENT_SERVICE', 'CLEANING_WASTE', 'TAX_FEES', 'OTHER')),
  amount_vnd bigint NOT NULL CHECK (amount_vnd > 0),
  occurred_at timestamptz NOT NULL,
  paid_to text,
  note text,
  payment_method text NOT NULL DEFAULT 'CASH'
    CHECK (payment_method IN ('CASH', 'BANK_TRANSFER', 'OTHER')),
  receipt_url text,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, property_id)
    REFERENCES properties (organization_id, id)
    ON DELETE SET NULL
);

CREATE INDEX operating_expenses_org_occurred_idx
  ON operating_expenses (organization_id, occurred_at DESC, id);

CREATE INDEX operating_expenses_property_occurred_idx
  ON operating_expenses (organization_id, property_id, occurred_at DESC, id);

CREATE INDEX operating_expenses_category_idx
  ON operating_expenses (organization_id, category, occurred_at DESC);

COMMIT;
