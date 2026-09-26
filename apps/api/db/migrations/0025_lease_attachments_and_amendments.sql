-- Migration: 0025_lease_attachments_and_amendments.sql
-- Description: Add attachments (identity, handover minutes) and contract amendment tracking for leases

CREATE TABLE IF NOT EXISTS lease_attachments (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  lease_id uuid NOT NULL REFERENCES leases(id) ON DELETE CASCADE,
  attachment_type text NOT NULL CHECK (attachment_type IN ('CITIZEN_ID_FRONT', 'CITIZEN_ID_BACK', 'HANDOVER_MINUTES', 'CONTRACT_SCAN', 'OTHER')),
  file_name text NOT NULL,
  file_url text NOT NULL,
  file_size_bytes bigint,
  mime_type text,
  note text,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS lease_attachments_org_lease_idx
  ON lease_attachments (organization_id, lease_id, uploaded_at DESC);

CREATE TABLE IF NOT EXISTS lease_amendments (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  lease_id uuid NOT NULL REFERENCES leases(id) ON DELETE CASCADE,
  amendment_number text NOT NULL,
  effective_date date NOT NULL,
  changes_summary text NOT NULL,
  adjusted_base_rent_vnd bigint CHECK (adjusted_base_rent_vnd IS NULL OR adjusted_base_rent_vnd >= 0),
  adjusted_deposit_required_vnd bigint CHECK (adjusted_deposit_required_vnd IS NULL OR adjusted_deposit_required_vnd >= 0),
  adjusted_planned_end_date date,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT lease_amendments_number_unique UNIQUE (organization_id, lease_id, amendment_number)
);

CREATE INDEX IF NOT EXISTS lease_amendments_org_lease_idx
  ON lease_amendments (organization_id, lease_id, effective_date DESC);
