BEGIN;

CREATE TABLE residents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  phone text,
  email text,
  identity_document_type text,
  identity_document_number text,
  date_of_birth date,
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id)
);

CREATE INDEX residents_org_name_idx
  ON residents (organization_id, full_name, id);

CREATE INDEX residents_org_phone_idx
  ON residents (organization_id, phone)
  WHERE phone IS NOT NULL;

CREATE TABLE leases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  room_id uuid NOT NULL,
  lease_code text NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN (
      'DRAFT',
      'ACTIVE',
      'TERMINATION_SCHEDULED',
      'TERMINATED',
      'CANCELLED'
    )),
  start_date date NOT NULL,
  planned_end_date date,
  signed_at timestamptz,
  activated_at timestamptz,
  termination_effective_date date,
  terminated_at timestamptz,
  termination_reason text,
  base_rent_vnd bigint NOT NULL CHECK (base_rent_vnd >= 0),
  deposit_required_vnd bigint NOT NULL DEFAULT 0 CHECK (deposit_required_vnd >= 0),
  billing_day smallint NOT NULL DEFAULT 1 CHECK (billing_day BETWEEN 1 AND 31),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, room_id)
    REFERENCES rooms (organization_id, id)
    ON DELETE RESTRICT,
  CHECK (planned_end_date IS NULL OR planned_end_date >= start_date),
  CHECK (
    (
      status IN ('TERMINATION_SCHEDULED', 'TERMINATED')
      AND termination_effective_date IS NOT NULL
    )
    OR
    (
      status IN ('DRAFT', 'ACTIVE', 'CANCELLED')
      AND termination_effective_date IS NULL
    )
  ),
  CHECK (
    termination_effective_date IS NULL
    OR termination_effective_date >= start_date
  ),
  UNIQUE (organization_id, lease_code),
  UNIQUE (organization_id, id)
);

CREATE INDEX leases_room_history_idx
  ON leases (organization_id, room_id, start_date DESC, id);

CREATE INDEX leases_status_idx
  ON leases (organization_id, status, start_date, id);

CREATE UNIQUE INDEX leases_one_current_per_room_uidx
  ON leases (organization_id, room_id)
  WHERE status IN ('ACTIVE', 'TERMINATION_SCHEDULED');

CREATE TABLE lease_residents (
  organization_id uuid NOT NULL,
  lease_id uuid NOT NULL,
  resident_id uuid NOT NULL,
  party_role text NOT NULL
    CHECK (party_role IN ('PRIMARY_TENANT', 'CO_TENANT', 'OCCUPANT')),
  joined_on date NOT NULL,
  left_on date,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, lease_id, resident_id),
  FOREIGN KEY (organization_id, lease_id)
    REFERENCES leases (organization_id, id)
    ON DELETE CASCADE,
  FOREIGN KEY (organization_id, resident_id)
    REFERENCES residents (organization_id, id)
    ON DELETE RESTRICT,
  CHECK (left_on IS NULL OR left_on >= joined_on)
);

CREATE UNIQUE INDEX lease_residents_one_primary_uidx
  ON lease_residents (organization_id, lease_id)
  WHERE party_role = 'PRIMARY_TENANT' AND left_on IS NULL;

CREATE INDEX lease_residents_resident_history_idx
  ON lease_residents (organization_id, resident_id, joined_on DESC, lease_id);

CREATE TABLE lease_terminations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  lease_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'SCHEDULED'
    CHECK (status IN ('SCHEDULED', 'READY', 'COMPLETED', 'CANCELLED')),
  effective_date date NOT NULL,
  reason text NOT NULL,
  meter_readiness text NOT NULL DEFAULT 'PENDING'
    CHECK (meter_readiness IN ('PENDING', 'READY', 'NOT_REQUIRED')),
  financial_readiness text NOT NULL DEFAULT 'PENDING'
    CHECK (financial_readiness IN ('PENDING', 'READY', 'NOT_REQUIRED')),
  deposit_readiness text NOT NULL DEFAULT 'PENDING'
    CHECK (deposit_readiness IN ('PENDING', 'READY', 'NOT_REQUIRED')),
  initiated_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  completed_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  cancelled_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  cancelled_at timestamptz,
  FOREIGN KEY (organization_id, lease_id)
    REFERENCES leases (organization_id, id)
    ON DELETE RESTRICT,
  UNIQUE (organization_id, id)
);

CREATE UNIQUE INDEX lease_terminations_one_open_uidx
  ON lease_terminations (organization_id, lease_id)
  WHERE status IN ('SCHEDULED', 'READY');

CREATE INDEX lease_terminations_readiness_idx
  ON lease_terminations (
    organization_id,
    status,
    meter_readiness,
    financial_readiness,
    deposit_readiness,
    effective_date
  );

CREATE TABLE lease_command_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  command_type text NOT NULL,
  lease_id uuid,
  response_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, lease_id)
    REFERENCES leases (organization_id, id)
    ON DELETE CASCADE,
  UNIQUE (organization_id, idempotency_key)
);

CREATE INDEX lease_command_receipts_lease_idx
  ON lease_command_receipts (organization_id, lease_id, created_at DESC)
  WHERE lease_id IS NOT NULL;

COMMIT;
