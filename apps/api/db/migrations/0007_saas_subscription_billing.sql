BEGIN;

ALTER TABLE organization_subscriptions
  ADD COLUMN billing_interval text NOT NULL DEFAULT 'MONTHLY'
    CHECK (billing_interval IN ('MONTHLY', 'YEARLY')),
  ADD COLUMN past_due_at timestamptz;

CREATE UNIQUE INDEX organization_subscriptions_org_id_uidx
  ON organization_subscriptions (organization_id, id);

CREATE TABLE saas_subscription_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  subscription_id uuid NOT NULL,
  plan_id uuid NOT NULL,
  plan_version_id uuid NOT NULL,
  billing_interval text NOT NULL
    CHECK (billing_interval IN ('MONTHLY', 'YEARLY')),
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  amount_vnd bigint NOT NULL CHECK (amount_vnd >= 0),
  status text NOT NULL DEFAULT 'OPEN'
    CHECK (status IN ('OPEN', 'PARTIALLY_PAID', 'PAID', 'VOID')),
  issued_at timestamptz NOT NULL DEFAULT now(),
  due_at timestamptz NOT NULL,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, subscription_id)
    REFERENCES organization_subscriptions (organization_id, id)
    ON DELETE RESTRICT,
  FOREIGN KEY (plan_id, plan_version_id)
    REFERENCES saas_plan_versions(plan_id, id)
    ON DELETE RESTRICT,
  UNIQUE (organization_id, id),
  UNIQUE (subscription_id, period_start, period_end),
  CHECK (period_end > period_start),
  CHECK (paid_at IS NULL OR status = 'PAID')
);

CREATE INDEX saas_subscription_invoices_due_idx
  ON saas_subscription_invoices (due_at, organization_id)
  WHERE status IN ('OPEN', 'PARTIALLY_PAID');

CREATE INDEX saas_subscription_invoices_org_period_idx
  ON saas_subscription_invoices (
    organization_id,
    period_start DESC,
    period_end DESC
  );

CREATE TABLE saas_subscription_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  subscription_id uuid NOT NULL,
  amount_vnd bigint NOT NULL CHECK (amount_vnd > 0),
  status text NOT NULL
    CHECK (status IN ('SUCCEEDED', 'FAILED', 'REFUNDED')),
  reconciliation_status text NOT NULL DEFAULT 'UNALLOCATED'
    CHECK (reconciliation_status IN (
      'UNALLOCATED',
      'ALLOCATED',
      'REVIEW_REQUIRED'
    )),
  source text NOT NULL
    CHECK (source IN ('MANUAL', 'PROVIDER')),
  provider text,
  provider_transaction_id text,
  idempotency_key text NOT NULL,
  occurred_at timestamptz NOT NULL,
  recorded_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, subscription_id)
    REFERENCES organization_subscriptions (organization_id, id)
    ON DELETE RESTRICT,
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, idempotency_key)
);

CREATE UNIQUE INDEX saas_subscription_payments_provider_tx_uidx
  ON saas_subscription_payments (provider, provider_transaction_id)
  WHERE provider IS NOT NULL
    AND provider_transaction_id IS NOT NULL;

CREATE INDEX saas_subscription_payments_org_time_idx
  ON saas_subscription_payments (
    organization_id,
    occurred_at DESC
  );

CREATE TABLE saas_subscription_payment_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  payment_id uuid NOT NULL,
  invoice_id uuid NOT NULL,
  amount_vnd bigint NOT NULL CHECK (amount_vnd > 0),
  allocated_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, payment_id)
    REFERENCES saas_subscription_payments (organization_id, id)
    ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, invoice_id)
    REFERENCES saas_subscription_invoices (organization_id, id)
    ON DELETE RESTRICT
);

CREATE INDEX saas_subscription_payment_allocations_invoice_idx
  ON saas_subscription_payment_allocations (
    organization_id,
    invoice_id,
    created_at
  );

CREATE INDEX saas_subscription_payment_allocations_payment_idx
  ON saas_subscription_payment_allocations (
    organization_id,
    payment_id,
    created_at
  );

INSERT INTO system_settings (
  key,
  group_key,
  label,
  description,
  value,
  value_type
)
VALUES
  (
    'renewal_invoice_lead_days',
    'Billing',
    'Số ngày tạo hóa đơn gia hạn trước kỳ mới',
    'Khoảng thời gian trước period_start để billing scheduler tạo renewal invoice.',
    '7'::jsonb,
    'INTEGER'
  ),
  (
    'past_due_warning_days',
    'Billing',
    'Số ngày cảnh báo quá hạn trước grace period',
    'Số ngày subscription ở PAST_DUE trước khi chuyển sang GRACE_PERIOD.',
    '1'::jsonb,
    'INTEGER'
  )
ON CONFLICT (key) DO NOTHING;

COMMIT;
