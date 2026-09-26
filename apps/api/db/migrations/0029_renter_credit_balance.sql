BEGIN;

-- ============================================================
-- 0029: Renter Credit Balance & Movement Ledger
--
-- Implements an append-only credit ledger for tenant renters.
-- Handles overpayment crediting, credit consumption on new invoices,
-- manual refunds, and allocation reversals.
--
-- Key design decisions:
--   1. credit_balances stores the current running total per org
--      (one row per organization, updated via triggers/application)
--   2. credit_movements is the append-only audit trail
--   3. All amounts in integer VND (bigint)
--   4. movement_type captures the reason for the credit change
--   5. Refunds are a separate concept linked to movements
-- ============================================================

-- Running credit balance per organization
CREATE TABLE renter_credit_balances (
  organization_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE RESTRICT,
  balance_vnd bigint NOT NULL DEFAULT 0
    CHECK (balance_vnd >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Append-only credit movement ledger
CREATE TABLE renter_credit_movements (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,

  -- Movement metadata
  movement_type text NOT NULL CHECK (movement_type IN (
    'OVERPAYMENT_CREDIT',    -- excess from a payment allocation
    'CREDIT_APPLIED',        -- credit consumed against an invoice (negative)
    'MANUAL_CREDIT',         -- admin manually grants credit
    'MANUAL_DEBIT',          -- admin manually deducts credit
    'REFUND_ISSUED',         -- credit converted to a refund (negative)
    'ALLOCATION_REVERSAL'    -- allocation reversed, amount returned as credit
  )),

  -- Amount: positive = credit in, negative = credit out
  amount_vnd bigint NOT NULL,
  balance_after_vnd bigint NOT NULL CHECK (balance_after_vnd >= 0),

  -- Optional references for traceability
  invoice_id uuid,          -- related renter invoice
  payment_transaction_id uuid,  -- related payment transaction
  allocation_id uuid,       -- related payment allocation

  -- Descriptive
  description text,
  note text,

  -- Actor
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX renter_credit_movements_org_time_idx
  ON renter_credit_movements (
    organization_id,
    created_at DESC,
    id
  );

CREATE INDEX renter_credit_movements_invoice_idx
  ON renter_credit_movements (organization_id, invoice_id)
  WHERE invoice_id IS NOT NULL;

-- Refund records (when credit is paid out)
CREATE TABLE renter_refunds (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  credit_movement_id uuid NOT NULL REFERENCES renter_credit_movements(id) ON DELETE RESTRICT,

  amount_vnd bigint NOT NULL CHECK (amount_vnd > 0),
  refund_method text NOT NULL DEFAULT 'CASH'
    CHECK (refund_method IN ('CASH', 'BANK_TRANSFER', 'OTHER')),
  recipient_name text,
  recipient_account text,
  note text,

  status text NOT NULL DEFAULT 'COMPLETED'
    CHECK (status IN ('COMPLETED', 'PENDING', 'CANCELLED')),

  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,

  UNIQUE (organization_id, id)
);

CREATE INDEX renter_refunds_org_idx
  ON renter_refunds (organization_id, created_at DESC, id);

COMMIT;
