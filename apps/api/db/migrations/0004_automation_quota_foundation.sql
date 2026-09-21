BEGIN;

INSERT INTO system_settings (
  key,
  group_key,
  label,
  description,
  value,
  value_type
)
VALUES (
  'automation_quota_timezone',
  'Automation',
  'Automation quota timezone',
  'Calendar-month timezone used for automation quota periods.',
  '"Asia/Ho_Chi_Minh"'::jsonb,
  'STRING'
)
ON CONFLICT (key) DO NOTHING;

CREATE TABLE automation_quota_periods (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  period_start date NOT NULL,
  period_end date NOT NULL,
  reserved_actions integer NOT NULL DEFAULT 0 CHECK (reserved_actions >= 0),
  consumed_actions integer NOT NULL DEFAULT 0 CHECK (consumed_actions >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, period_start),
  CHECK (period_end > period_start)
);

CREATE INDEX automation_quota_periods_current_idx
  ON automation_quota_periods (organization_id, period_end DESC, period_start DESC);

CREATE TABLE automation_quota_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  period_start date NOT NULL,
  idempotency_key text NOT NULL,
  source_type text NOT NULL,
  source_id text,
  requested_actions integer NOT NULL CHECK (requested_actions > 0),
  consumed_actions integer NOT NULL DEFAULT 0 CHECK (consumed_actions >= 0),
  released_actions integer NOT NULL DEFAULT 0 CHECK (released_actions >= 0),
  status text NOT NULL DEFAULT 'OPEN'
    CHECK (status IN ('OPEN', 'COMPLETED', 'RELEASED')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, idempotency_key),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, period_start)
    REFERENCES automation_quota_periods(organization_id, period_start)
    ON DELETE RESTRICT,
  CHECK (consumed_actions + released_actions <= requested_actions)
);

CREATE INDEX automation_quota_reservations_period_idx
  ON automation_quota_reservations (
    organization_id,
    period_start,
    status,
    created_at DESC
  );

CREATE TABLE automation_quota_consumptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  reservation_id uuid NOT NULL,
  consumption_key text NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, reservation_id)
    REFERENCES automation_quota_reservations(organization_id, id)
    ON DELETE CASCADE,
  UNIQUE (organization_id, reservation_id, consumption_key)
);

CREATE INDEX automation_quota_consumptions_reservation_idx
  ON automation_quota_consumptions (
    organization_id,
    reservation_id,
    created_at
  );

COMMIT;
